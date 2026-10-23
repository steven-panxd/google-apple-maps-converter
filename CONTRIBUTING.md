# Contributing

Thanks for helping! The most useful contribution is a link that doesn't convert: [open an issue](https://github.com/steven-panxd/google-apple-maps-converter/issues/new?title=Unsupported%20link) and paste it.

## Development

```sh
npm test
```

| Folder | What's in it |
|---|---|
| `src/` | The library (the only folder published to npm) |
| `test/` | Unit tests, run with Node's built-in test runner |
| `site/` | The web converter and the shortcut guide, deployed to GitHub Pages at maps.xuedo.ng |
| `shortcut/` | `rules.json`, the regex rules the shortcut runs on the phone, and `build.py`, which generates and signs the shortcut (macOS) |
| `worker/` | Optional Cloudflare Worker that expands short links for the web page (not deployed) |

When you change parsing or link building, add a test with the real link that prompted it. `test/shortcut-rules.test.js` checks the shortcut's rules against the library, so a rule can't drift from it.

## Ideas

- Safari extension (iOS and macOS) that opens Google Maps links in Apple Maps automatically
- Userscript
