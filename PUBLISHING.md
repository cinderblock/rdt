# Publishing RDT

We're currently publishing to [@cinderblock/rdt](https://www.npmjs.com/package/@cinderblock/rdt) on NPM.

## Pre-publishing

Update change log in [CHANGES.md](CHANGES.md).

## Publishing

[![Publish](https://github.com/cinderblock/rdt/actions/workflows/publish.yaml/badge.svg?event=push)](https://github.com/cinderblock/rdt/actions/workflows/publish.yaml)

All publishing is done through GitHub Actions.
The [`publish` workflow](.github\workflows\publish.yaml) is triggered by a tag push.

The easiest way to do this is:

1.  Update the version in `package.json` and create a tag. Ideally use `npm version` to do this:
    - `npm version patch` - minor changes, bug fixes
    - `npm version minor` - new features
    - `npm version major` - major/breaking changes
2.  Push the tag
    - `git push --tags`

### Script

See the [publish.yaml](.github/workflows/publish.yaml) workflow for the script that runs on publish.
