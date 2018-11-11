import * as ts from 'typescript';
import { TextDocument } from 'vscode-languageserver-types';
import { Stylesheet } from 'vscode-css-languageservice';
import { LanguageModelCache } from './language-model-cache';


export interface StyledJsxTaggedTemplate {
	start: number;
	end: number
}

export interface StyledJsxTagAttributes {
	firstAttributeName: string | undefined;
	secondAttributeName: string | undefined
}

export interface StyledJsx {
	cssDocument: TextDocument;
	stylesheet: Stylesheet;
}

const styledJsxPattern = /((<\s*?style\s*?(global)?\s*?jsx\s*?(global)?\s*?>)|(\s*?css\s*?`)|(\s*?css\.global\s*?`))/g;
export function getApproximateStyledJsxOffsets(document: TextDocument): number[] {
	const results = [];
	const doc = document.getText();
	while (styledJsxPattern.exec(doc)) {
		results.push(styledJsxPattern.lastIndex);
	}
	return results;
}

// css`button { position: relative; }`
export function isStyledJsxTaggedTemplate(token: any): boolean {
	if (token && token.kind === ts.SyntaxKind.TaggedTemplateExpression) {
		const tagText = token.tag.getText()
		if (tagText === 'css' || tagText === 'css.global') {
			return true;
		}
	}
	return false;
}

function getStyleTagAttributeNames(openingElement: ts.JsxOpeningElement): StyledJsxTagAttributes {
	const { properties } = openingElement.attributes;
	const firstAttribute = properties[0];
	const secondAttribute = properties[1];
	const firstAttributeName = firstAttribute && firstAttribute.name!.getText();
	const secondAttributeName = secondAttribute && secondAttribute.name!.getText();

	return {
		firstAttributeName,
		secondAttributeName
	}
}

// Is <style jsx/>. Maybe there is a better name for function
export function isStyledJsxTag(token: ts.Node) {
	if (token && token.kind === ts.SyntaxKind.JsxElement) {
		const openingElement: ts.JsxOpeningElement = (token as ts.JsxElement).openingElement;
		const closingElement: ts.JsxClosingElement = (token as ts.JsxElement).closingElement;
		// Check that opening and closing tags are 'style'
		if (openingElement.tagName.getText() === 'style' && closingElement.tagName.getText() === 'style') {
			const { firstAttributeName, secondAttributeName } = getStyleTagAttributeNames(openingElement);
			// Check that opening element has 'jsx' with optional 'global' attribute.
			if (firstAttributeName === 'jsx' || (firstAttributeName === 'global' && secondAttributeName === 'jsx')) {
				const nextToken = (ts as any).findNextToken(openingElement, openingElement.parent);
				// Check if there is a '{'
				if (nextToken && nextToken.kind === ts.SyntaxKind.FirstPunctuation) {
					const anotherNextToken = (ts as any).findNextToken(nextToken, nextToken.parent);
					// Check if there is a beginning of the template string. This is neccessary to skip things like <style jsx>{styles}</style>
					if (anotherNextToken && anotherNextToken.kind === ts.SyntaxKind.FirstTemplateToken || anotherNextToken.kind === ts.SyntaxKind.TemplateHead) {
						return true;
					}
				}
			}
		}
	}
	return false;
}

export function findStyledJsxTaggedTemplate(textDocument: TextDocument, cursorOffsets: number[]) : StyledJsxTaggedTemplate[] {
	const source = ts.createSourceFile('tmp', textDocument.getText(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX | ts.ScriptKind.TSX);

	const result: StyledJsxTaggedTemplate[] = [];
	for (let i = 0; i < cursorOffsets.length; i++) {
		let token = (ts as any).getTokenAtPosition(source, cursorOffsets[i])
		while (token) {
			if (isStyledJsxTaggedTemplate(token)) {
				result.push({
					start: token.template.getStart() + 1, // escape `
					end: token.template.getEnd() - 1 // escape `
				});
				break;
			}
			else if (isStyledJsxTag(token)) {
				result.push({
					start: token.openingElement.getEnd() + 2, // escape `
					end: token.closingElement.getStart() - 2 // escape `
				});
				break;
			}
			token = token.parent;
		}
	}
	return result;
}

const expressionPattern = /(.*\${.*}.*)|(.*(&&|[||]).*)/g
// I guess so long functions are bad. Don't know how to properly format in typescript.
export function replaceAllWithSpacesExceptCss(textDocument: TextDocument, styledJsxTaggedTemplates: StyledJsxTaggedTemplate[], stylesheets: LanguageModelCache<Stylesheet>): { cssDocument: TextDocument, stylesheet: Stylesheet } {
	const text = textDocument.getText();
	let result = '';
	// code that goes before CSS
	result += text.slice(0, styledJsxTaggedTemplates[0].start).replace(/./g, ' ');
	for (let i = 0; i < styledJsxTaggedTemplates.length; i++) {
		// CSS itself with dirty hacks. Maybe there is better solution. 
		// We need to find all expressions in css and replace each character of expression with space.
		// This is neccessary to preserve character count
		result += text.slice(styledJsxTaggedTemplates[i].start, styledJsxTaggedTemplates[i].end).replace(expressionPattern, (str, p1) => {
			return p1.replace(/./g, ' ')
		});
		// if there is several CSS parts
		if (i + 1 < styledJsxTaggedTemplates.length) {
			// code that is in between that CSS parts
			result  += text.slice(styledJsxTaggedTemplates[i].end, styledJsxTaggedTemplates[i+1].start).replace(/./g, ' ');
		}
	}
	// code that goes after CSS
	result += text.slice(styledJsxTaggedTemplates[styledJsxTaggedTemplates.length-1].end, text.length).replace(/./g, ' ');

	const cssDocument = TextDocument.create(textDocument.uri.toString(), 'css', textDocument.version, result);
	const stylesheet = stylesheets.get(cssDocument);

	return {
		cssDocument,
		stylesheet
	}
}

export function getStyledJsx(document: TextDocument, stylesheets: LanguageModelCache<Stylesheet>): StyledJsx | undefined {
	const styledJsxOffsets = getApproximateStyledJsxOffsets(document);
		if (styledJsxOffsets.length > 0) {
			const styledJsxTaggedTemplates = findStyledJsxTaggedTemplate(document, styledJsxOffsets);
			if (styledJsxTaggedTemplates.length > 0) {
				return replaceAllWithSpacesExceptCss(document, styledJsxTaggedTemplates, stylesheets);
			}
		}
	return undefined;
}

export function getStyledJsxUnderCursor(document: TextDocument, stylesheets: LanguageModelCache<Stylesheet>, cursorOffset: number): StyledJsx | undefined {
	const styledJsxTaggedTemplates = findStyledJsxTaggedTemplate(document, [cursorOffset]);

	if (styledJsxTaggedTemplates.length > 0 && styledJsxTaggedTemplates[0].start < cursorOffset && styledJsxTaggedTemplates[0].end > cursorOffset) {
		return replaceAllWithSpacesExceptCss(document, styledJsxTaggedTemplates, stylesheets);
	}
	return undefined;
}