/* eslint-disable no-unused-vars */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  createConnection,
  TextDocuments,
  ConfigurationRequest,
  TextDocument,
  TextDocumentSyncKind,
  CompletionList,
  WorkspaceEdit,
  RenameParams,
  ColorPresentationParams,
  ColorPresentation,
  SymbolInformation,
  DocumentSymbol,
  DocumentSymbolParams,
  Hover,
  ReferenceParams,
  CodeActionParams,
  CompletionParams,
  DocumentColorParams,
  ConfigurationParams,
  DidChangeConfigurationParams,
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
  IConnection,
  TextDocumentPositionParams,
  TextDocumentChangeEvent,
  Command,
  CodeAction,
  Definition,
  DefinitionLink,
  Location,
  DocumentHighlight,
} from "vscode-languageserver";

import {
  getSCSSLanguageService,
  Stylesheet,
  LanguageSettings,
  LanguageService,
  ColorInformation,
} from "vscode-css-languageservice";

import { getLanguageModelCache, LanguageModelCache } from "./language-model-cache";

import { getStyledJsx, getStyledJsxUnderCursor, StyledJsx } from "./styled-jsx-utils";

// Create a connection for the server.
const connection: IConnection = createConnection();

console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments = new TextDocuments();

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

const stylesheets: LanguageModelCache<Stylesheet> = getLanguageModelCache<Stylesheet>(
  10,
  60,
  (document) => cssLanguageService.parseStylesheet(document)
);

documents.onDidClose((e) => {
  stylesheets.onDocumentRemoved(e.document);
});

connection.onShutdown(() => {
  stylesheets.dispose();
});

let scopedSettingsSupport: boolean = false;

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
connection.onInitialize(
  (params: InitializeParams): InitializeResult => {
    function hasClientCapability(name: string): boolean {
      let c: any = params.capabilities;
      for (const key of name.split(".")) {
        c = c[key];
      }

      return !!c;
    }
    const snippetSupport = hasClientCapability(
      "textDocument.completion.completionItem.snippetSupport"
    );
    scopedSettingsSupport = hasClientCapability("workspace.configuration");
    const capabilities: ServerCapabilities = {
      // Tell the client that the server works in FULL text document sync mode
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: snippetSupport ? { resolveProvider: false } : undefined,
      hoverProvider: true,
      documentSymbolProvider: true,
      referencesProvider: true,
      definitionProvider: true,
      documentHighlightProvider: true,
      codeActionProvider: true,
      renameProvider: false,
      colorProvider: true,
    };
    return { capabilities };
  }
);

const cssLanguageService: LanguageService = getSCSSLanguageService();

let documentSettings: {
  [key: string]: Thenable<LanguageSettings | undefined>;
} = {};

// remove document settings on close
documents.onDidClose((e: TextDocumentChangeEvent) => {
  delete documentSettings[e.document.uri];
});

function getDocumentSettings(textDocument: TextDocument): Thenable<LanguageSettings | undefined> {
  if (scopedSettingsSupport) {
    let promise: Thenable<LanguageSettings | undefined> = documentSettings[textDocument.uri];
    if (!promise) {
      const configRequestParam: ConfigurationParams = {
        items: [{ scopeUri: textDocument.uri, section: "css" }],
      };
      promise = connection
        .sendRequest(ConfigurationRequest.type, configRequestParam)
        .then((s) => s[0]);
      documentSettings[textDocument.uri] = promise;
    }
    return promise;
  }
  return Promise.resolve(void 0);
}

// The settings have changed. Is send on server activation as well.
connection.onDidChangeConfiguration((change: DidChangeConfigurationParams): void => {
  updateConfiguration(<LanguageSettings>change.settings.css);
});

function updateConfiguration(settings: LanguageSettings): void {
  cssLanguageService.configure(settings);
  // reset all document settings
  documentSettings = {};
  // Revalidate any open text documents
  documents.all().forEach(triggerValidation);
}

const pendingValidationRequests: { [uri: string]: NodeJS.Timer } = {};
const validationDelayMs: number = 200;

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: TextDocumentChangeEvent) => {
  triggerValidation(change.document);
});

// a document has closed: clear all diagnostics
documents.onDidClose((event: TextDocumentChangeEvent) => {
  clearDiagnostics(event.document);
});

function clearDiagnostics(document: TextDocument): void {
  cleanPendingValidation(document);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
}

function cleanPendingValidation(textDocument: TextDocument): void {
  const request = pendingValidationRequests[textDocument.uri];
  if (request) {
    clearTimeout(request);
    delete pendingValidationRequests[textDocument.uri];
  }
}

function triggerValidation(textDocument: TextDocument): void {
  cleanPendingValidation(textDocument);
  pendingValidationRequests[textDocument.uri] = setTimeout(() => {
    delete pendingValidationRequests[textDocument.uri];
    validateTextDocument(textDocument);
  }, validationDelayMs);
}

function validateTextDocument(document: TextDocument): void {
  const settingsPromise = getDocumentSettings(document);
  settingsPromise.then((settings) => {
    const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
    if (styledJsx) {
      const { cssDocument, stylesheet } = styledJsx;
      const diagnostics = cssLanguageService.doValidation(cssDocument, stylesheet, settings);
      connection.sendDiagnostics({ uri: document.uri, diagnostics });
    } else {
      clearDiagnostics(document);
    }
  });
}

connection.onCompletion((textDocumentPosition: CompletionParams):
  | CompletionList
  | undefined
  | null => {
  const document: TextDocument | undefined = documents.get(textDocumentPosition.textDocument.uri);

  if (!document) {
    return undefined;
  }

  const cursorOffset: number = document.offsetAt(textDocumentPosition.position);

  const styledJsx: StyledJsx | undefined = getStyledJsxUnderCursor(
    document,
    stylesheets,
    cursorOffset
  );

  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.doComplete(cssDocument, textDocumentPosition.position, stylesheet);
  }
  return null;
});

connection.onHover((textDocumentPosition: TextDocumentPositionParams): Hover | undefined | null => {
  const document: TextDocument | undefined = documents.get(textDocumentPosition.textDocument.uri);
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);

  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.doHover(cssDocument, textDocumentPosition.position, stylesheet);
  }
  return null;
});

connection.onDocumentSymbol((documentSymbolParams: DocumentSymbolParams):
  | SymbolInformation[]
  | DocumentSymbol[]
  | undefined
  | null => {
  const document: TextDocument | undefined = documents.get(documentSymbolParams.textDocument.uri);
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.findDocumentSymbols(cssDocument, stylesheet);
  }
  return null;
});

connection.onDefinition((documentSymbolParams: TextDocumentPositionParams):
  | Definition
  | DefinitionLink[]
  | undefined
  | null => {
  const document: TextDocument | undefined = documents.get(documentSymbolParams.textDocument.uri);
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.findDefinition(
      cssDocument,
      documentSymbolParams.position,
      stylesheet
    );
  }
  return null;
});

connection.onDocumentHighlight((documentHighlightParams: TextDocumentPositionParams):
  | DocumentHighlight[]
  | undefined
  | null => {
  const document: TextDocument | undefined = documents.get(
    documentHighlightParams.textDocument.uri
  );
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.findDocumentHighlights(
      cssDocument,
      documentHighlightParams.position,
      stylesheet
    );
  }
  return null;
});

connection.onReferences((referenceParams: ReferenceParams): Location[] | undefined | null => {
  const document: TextDocument | undefined = documents.get(referenceParams.textDocument.uri);
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.findReferences(cssDocument, referenceParams.position, stylesheet);
  }
  return null;
});

connection.onCodeAction((codeActionParams: CodeActionParams):
  | (Command | CodeAction)[]
  | undefined
  | null => {
  const document: TextDocument | undefined = documents.get(codeActionParams.textDocument.uri);
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.doCodeActions(
      cssDocument,
      codeActionParams.range,
      codeActionParams.context,
      stylesheet
    );
  }
  return null;
});

connection.onDocumentColor((params: DocumentColorParams): ColorInformation[] | undefined | null => {
  const document: TextDocument | undefined = documents.get(params.textDocument.uri);
  if (document) {
    const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
    if (styledJsx) {
      const { cssDocument, stylesheet } = styledJsx;
      return cssLanguageService.findDocumentColors(cssDocument, stylesheet);
    }
  }
  return [];
});

connection.onColorPresentation((params: ColorPresentationParams):
  | ColorPresentation[]
  | undefined
  | null => {
  const document: TextDocument | undefined = documents.get(params.textDocument.uri);
  if (document) {
    const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);

    if (styledJsx) {
      const { cssDocument, stylesheet } = styledJsx;
      return cssLanguageService.getColorPresentations(
        cssDocument,
        stylesheet,
        params.color,
        params.range
      );
    }
  }
  return [];
});

connection.onRenameRequest((renameParameters: RenameParams): WorkspaceEdit | undefined | null => {
  const document: TextDocument | undefined = documents.get(renameParameters.textDocument.uri);
  if (!document) {
    return null;
  }

  const styledJsx: StyledJsx | undefined = getStyledJsx(document, stylesheets);
  if (styledJsx) {
    const { cssDocument, stylesheet } = styledJsx;
    return cssLanguageService.doRename(
      cssDocument,
      renameParameters.position,
      renameParameters.newName,
      stylesheet
    );
  }
  return null;
});

// Listen on the connection
connection.listen();
