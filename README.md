github-jira-sync
================


Syncs JIRA tickets and tasks with GitHub issues

### Install
```
npm install -g stephanieerin/github-jira-sync
```

### Run

Create a json file (modeled after proj.json in the repository) and change per your configurations. Then:
```
github-jira-sync project.json
```

### Features

- Creates GitHub issues from JIRA tickets
- Resolves JIRA tickets when the associated GitHub issue is closed
- Allows for different repositories to be selected (see Implementation Notes!)
- Assigns the GitHub user defined in your GitHub user mappings section of the project.json file to the GitHub issue
    - If no one is assigned in JIRA then no one will be assigned in GitHub

### Implementation Notes

1. The repo that's listed in the project.json file you specify will be used **if** there isn't one provided by a component in the JIRA ticket. You should configur your JIRA instance to use components to handle this.


### Current Limitations

 - Doesn't create issues in multiple repositories on GitHub (multiple components)
 - Nice to have: include commit comment when resolving issue
 - Update assignee in GitHub if assignee in JIRA changes
 - Sub-Task linking is wonky