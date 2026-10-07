# Releasing

Confirm GitHub owner, npm name, source ownership and license before publishing.
The public repository must contain a clean package export, without Alpine history,
adapters, private fixtures, credentials or proof receipts.

1. Export package source, scripts, tests, example, docs and repository metadata.
2. Set public name, preview version, license and repository URL. Update example
   imports/dependency and protocol version together. Add the chosen LICENSE.
3. Retain the dependency lockfile. Build and prove the installed tarball outside
   Alpine on macOS and Linux. Inspect members and retain the artifact hash.
4. Push clean source, enable private vulnerability reporting and create release
   notes tied to the source commit and artifact identity.
5. Publish the verified artifact with public access and `next`. Test a fresh
   registry install before claiming registry availability.
6. Configure the exact repository/workflow as an npm trusted publisher with the
   intended publish permission. Follow [npm's instructions](https://docs.npmjs.com/trusted-publishers/).

Publishing needs actual npm authorization. The release workflow does not create
an account or infer rights. After launch, make the public repo the source of truth;
replace Alpine's workspace copy with a versioned dependency in a separately
verified integration change, rather than maintaining diverging copies.

GitHub and npm are the first channels. Next, have a new developer follow the guide
and prepare a small Playwright community walkthrough showing one real run.
Announcements remain drafts until explicitly sent; visibility cannot guarantee use.
