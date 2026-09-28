# Security

## Reporting a problem

Please report a security problem privately: on this repository, open **Security**, then **Report a vulnerability**. If that button is not there, open an issue that says only "security contact wanted" (no details) and the owner will get in touch. Please do not post details in a public issue.

## What this repository holds

- No keys, passwords, tokens or accounts. The scheduled jobs use only GitHub's built-in, short-lived `GITHUB_TOKEN`, and each workflow asks for the least access it needs (`permissions:` in every file under `.github/workflows/`).
- Every action a workflow uses is pinned to a fixed commit, so a changed tag upstream cannot change what runs here.
- Only the repository owner's issues can change the push watch list (`.github/workflows/push-watches.yml` and `tools/push_admin.mjs` both check). Watches from anyone else are ignored.
- The push watch list (`data/push/watches.json`) is public because the repository is public, and it includes each watch's ntfy channel name. Anyone who reads that name can subscribe to the channel. Use a fresh channel for each watch and do not put anything private in a watch's name or keywords.
- The data is public open-source reporting. Records name no private individuals except sanctioned or charged people, and hold no phone numbers.

## Rights

Being public lets anyone view and fork this repository on GitHub. It does not let anyone reuse it: see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
