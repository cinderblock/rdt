# Publishing RDT

We're currently publishing to [@cinderblock/rdt](https://www.npmjs.com/package/@cinderblock/rdt) on NPM.

## Publishing

Push a new tag that starts with `v` to trigger a publish.

Make sure to update the version in `package.json` before pushing the tag.

The easiest way to do this is to run `npm version patch` or `npm version minor` or `npm version major` to update the version and create a tag.

Then push the tag _(with `git push --tags`)_.

### Script

See the [publish.yaml](.github/workflows/publish.yaml) workflow for the script that runs on publish.
