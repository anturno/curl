# Pull Request Review

Curl evaluates pull-request changes for correctness and security, then communicates one prioritized result on the pull request.

## Language

**Review**:
An evaluation of a pull request's changed behavior and security risks against the repository's intended contract.
_Avoid_: Audit, scan, lint

**Review head**:
The exact commit a review evaluates. Findings are about this commit and may be historical if the pull request advances before delivery.
_Avoid_: Current version, branch head

**Review summary**:
Curl's single prioritized communication of review findings on a pull request.
_Avoid_: Digest, report, comment thread

**Check Run**:
The GitHub status associated with a review head that communicates whether Curl is in progress, complete, cancelled, or failed.
_Avoid_: Build, CI check

**Mention-driven review**:
A review started when a person explicitly mentions Curl on a pull request or inline review thread.
_Avoid_: Manual scan, interactive review

**Automatic review**:
A review started by an eligible pull-request webhook event, subject to the deployment's explicit enablement and repository policy.
_Avoid_: Background review, passive review
