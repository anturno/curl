---
"anturno-curl": patch
---

Bound Curl's custom just-bash sandbox with resident-workspace and per-command
execution limits, and restore the workspace root after a checkout clears it so
a tree with no blobs still leaves a usable working directory. Upgrade just-bash
to 3.2.0 and pin its defense-in-depth layer off, because that layer installs
Node module hooks Bun does not implement and its `"auto"` mode does not detect
the gap.

Rename the sandbox backend to `just-bash`. Eve decides which optional engine
packages to trace into a hosted build from the backend name in the compiled
manifest, so an unrecognized name left `just-bash` untraced and the deployed
function failed on cold start with `ERR_MODULE_NOT_FOUND`.

Host-side GitHub checkout now shares the 64 MB workspace ceiling (failing before
blob materialization), fetches blobs with bounded concurrency, and resolves
branch refs to a real commit SHA before recording `state.headSha`.
