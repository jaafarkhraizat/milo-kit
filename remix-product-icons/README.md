# Remix Product Icons

VS Code product icon theme. Maps 232 codicons to RemixIcon 4.6.0 line glyphs. Unmapped icons (code symbols, breakpoints) fall back to VS Code defaults.

- Install: `code --install-extension remix-product-icons-1.0.0.vsix`
- Activate: Settings > `workbench.productIconTheme` = `remix-product-icons`
- Edit mappings: `build/generate.py`, then `python3 build/generate.py`
- Rebuild: `npx @vscode/vsce package --allow-missing-repository`

RemixIcon is Apache-2.0 (https://github.com/Remix-Design/RemixIcon).
