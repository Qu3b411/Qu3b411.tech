
# Welcome

This is the back-end repository for the qu3b411 command and control system.

## Overview

The qu3b411 back-end is designed to efficiently manage and control various components of our infrastructure. It's built with robustness and scalability in mind, ensuring that as our system grows, our back-end can handle the increasing demand.

## Branching Strategy

We use a multi-branch workflow, primarily revolving around three main branches:

    dev: This branch is for active development. Features, bug fixes, and other code changes are first merged into this branch.

    pre-prod: Before changes are merged into the production branch (master), they are first merged into pre-prod for testing and staging purposes.

    master: This is our production branch. Changes are merged into this branch only when they're tested and ready for production deployment.

## CI/CD and Branch Protection
### Workflow:

    **Development:** Code changes should be initiated in feature branches or directly in the dev branch.
    **Pull Requests:** All commits to master must come via pull requests. Pull requests to master should originate only from the pre-prod branch.
    **Branch Protection:** We have GitHub Actions in place that ensure pull requests to master originate only from pre-prod. Direct commits to either branch are not allowed.

### Contribution:

   1.  Start by making changes in your feature branch or dev.
   2.  Ensure all tests pass and the application runs as expected.
   3.  Create a pull request to master from pre-prod for review.
   4.  Ensure the "Check Source Branch" GitHub Action passes before merging.

### Getting Started

   1.  Clone the Repository:

```

git clone  https://github.com/Qu3b411/Qu3b411.tech/
```

2.  Switch to dev branch:

```

git checkout dev
```

3. Stay Updated: Regularly pull the latest changes from master to ensure your local environment is up-to-date:

```

git pull origin master
```
