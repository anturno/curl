# Pull Request Review

Curl evaluates pull-request changes for correctness and security, then communicates one prioritized result on the pull request.

## Language

**Review**:
An evaluation of a pull request's changed behavior and security risks against the repository's intended contract.
_Avoid_: Audit, scan, lint

**Review head**:
The exact commit a review evaluates. Findings are about this commit.
_Avoid_: Current version, branch head

**Review summary**:
Curl's single prioritized communication of review findings on a pull request.
_Avoid_: Digest, report, comment thread

**Mention-driven review**:
A review started when a person explicitly mentions Curl on a pull request or inline review thread.
_Avoid_: Manual scan, interactive review

**Diff-only checkout**:
Curl materializes only the pull request's changed files into the review workspace.
_Avoid_: Full tree, full clone
