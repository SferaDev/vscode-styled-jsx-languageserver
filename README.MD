# styled-jsx Language Server

Language server for [styled-jsx](https://github.com/zeit/styled-jsx). Install it
from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=Southclaws.vscode-styled-jsx-languageserver)

Forked from [this project](https://github.com/Grimones/vscode-styled-jsx-languageserver)
and merged all outstanding pull requests.

## Prerequisites

The extension requires that the
[vscode-styled-jsx-plugin-scss](https://marketplace.visualstudio.com/items?itemName=bfanger.vscode-styled-jsx-plugin-scss)
syntax highliter is installed. The extension will not work without it, because
the `vscode-styled-jsx` converts template literals to language which can be
detected by language server.

## How it works

Consider this component:

```jsx
const Button = (props) => (
  <button>
    {props.children}
    <style jsx>{`
      button {
        color: #999;
        display: inline-block;
        font-size: 2em;
      }
    `}</style>
    <style jsx>{`
      button {
        padding: ${"large" in props ? "50" : "20"}px;
        position: relative;
        background: ${props.theme.background};
      }
    `}</style>
  </button>
);
```

All the surrounding JSX will be removed, leaving just the CSS:

```




        button {
          color: #999;
          display: inline-block;
          font-size: 2em;
        }


        button {

          position: relative;

        }




```

The reason for this is to preserve line numbers for the language server in order
to correctly propose completions, underline problems and highlight symbols.

## Features

It should provide all the features that simply opening a `.css` file would:

- `CSS` code completion

  ![css-completion](https://thumbs.gfycat.com/FortunateScarceBufeo-size_restricted.gif)

- Hovers

  ![hover](https://thumbs.gfycat.com/PolishedIllustriousAmphibian-size_restricted.gif)

- Class names completion

  ![classname-completion](https://thumbs.gfycat.com/WelllitQuestionableGavial-size_restricted.gif)

- Color picker

  ![color-picker](https://thumbs.gfycat.com/UnimportantGrossFlatfish-size_restricted.gif)

- Linting

  ![lint](https://thumbs.gfycat.com/BlaringEmbellishedAfricanjacana-size_restricted.gif)

- Quick fixes

  ![quick-fixes](https://thumbs.gfycat.com/RelievedHarmoniousIberiannase-size_restricted.gif)

- Multiple `<style jsx/>` tags in file

  ![multiply-tags](https://i.imgur.com/n7VzljO.png)

- External styles `styled-jsx/css`

  ![external-styles](https://i.imgur.com/NiSKtQW.png)

## Caveats

- Template literal expressions are replaced with whitespace.

- Extension settings are bound to the CSS settings in vscode.

- There are some weird issues with multi-line expressions (like grid templates)

## Contribute

This was forked from a seemingly unmaintained repository. I merged all the
existing pull requests and will be happy to maintain this going forward.

## Todo

- Fix the duplicate color previews
