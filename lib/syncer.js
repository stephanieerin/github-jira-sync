(function syncer() {

    var JiraApi = require('jira').JiraApi;
    var GithubApi = require('github');
    var _ = require('underscore');
    var async = require('async');
    var jiraExtension = require('./jira-extension.js');
    var context = {};
    var request = require('request');

    var configApis = function configApis(config) {
        var apis = { jira: {} };
        apis.jira.default = new JiraApi(
            config.jira.protocol,
            config.jira.host,
            config.jira.port,
            config.jira.user,
            config.jira.password,
            config.jira.defaultApi.version
        );
        apis.jira.greenhopper = new JiraApi(
            config.jira.protocol,
            config.jira.host,
            config.jira.port,
            config.jira.user,
            config.jira.password,
            config.jira.greenhopper.version
        );
        jiraExtension.extend(apis.jira.greenhopper);

        apis.github = new GithubApi({version: "3.0.0"});
        apis.github.authenticate(config.github.auth);
        return apis;
    };

    var errorLog = function(error) {
        if(error) {
            console.log(error);
        }
    };

    var getCurrentSprint = function getCurrentSprint(callback) {
        context.api.jira.greenhopper.findRapidView(context.config.jira.project, function(error, rapidView) {
            context.rapidView = rapidView;
            context.api.jira.greenhopper.getLastSprintForRapidView(rapidView.id, function(error, sprint) {
                context.sprint = sprint;
                console.log('Sprint: ' + sprint.name);
                callback(error, sprint);
            });
        });
    };


    var getGithubIssues = function getGithubIssues(callback) {
        _.each(context.config.github.repos, function(repo){
            var filter = _.extend({
                sort: 'updated',
                direction: 'desc',
                per_page: 100,
                repo: repo
            }, context.config.github);
            context.api.github.issues.repoIssues(filter, function saveGhIssues(error, issues) {
                context.ghIssues = issues;
                console.log('Got ' + issues.length + ' issues open in repo ' + repo );
                callback(error, issues);
            });
        });
    };

    var getClosedGithubIssues = function getClosedGithubIssues(callback) {
        _.each(context.config.github.repos, function(repo){
            var filter = _.extend({
                state: 'closed',
                sort: 'updated',
                direction: 'desc',
                per_page: 100,
                repo: repo
            }, context.config.github);
            context.api.github.issues.repoIssues(filter, function saveGhIssues(error, issues) {
                context.ghClosedIssues = issues;
                context.ghIssues = _.union(issues, context.ghIssues);
                console.log('Got ' + issues.length + ' issues closed in repo ' + repo );
                callback(error, issues);
            });
        });
    };

    var getGhIssueFor = function getGhIssue(jiraIssue) {
        var match =  _.find(context.ghIssues, function(current) {
            return current.title.match("^" + jiraIssue.key);
        });
        return match;
    };

    var getGhUserFor = function getGhUserFor(jiraUser) {
        return context.config.userMapping[jiraUser];
    };

    var createGhIssue = function createGhIssue(jiraIssue, callback) {
        context.api.jira.default.findIssue(jiraIssue.key, function getIssue(error, completeIssue){
            var repo = completeIssue.fields.components[0].name.toLowerCase();

            // At some point I'd like to check to make sure it's a valid repo, though the front end enforces this.

            if(!repo){
                repo = context.config.github.repos[0];
            }

            var ghUser = getGhUserFor(jiraIssue.assignee);

            var args = _.extend({
                title: (jiraIssue.key + ': ' + jiraIssue.summary).toString('utf8'),
                labels: [jiraIssue.typeName, jiraIssue.priorityName],
                headers: {
                    authorization: 'Basic ' + new Buffer(context.config.github.auth.username + ":" + context.config.github.auth.password, "ascii").toString("base64"),
                    'content-type': 'application/json'
                },
                repo: repo,
                user: context.config.github.user
            });

            if(ghUser){
                args = _.extend({
                    assignee: ghUser
                }, args);
            }

            context.api.github.issues.create(args, function afterRequest(e, r, body) {
                console.log('\t-Created New');
                callback(e);
            });
        });
    };

    var jiraTypes = [
        'Task', 'Bug', 'Sub-task', 'User Story'
    ];

    var validIssueTypeForImport = function validIssueTypeForImport(typeName) {
        var match = _.find(jiraTypes, function finder(jiraType) {return jiraType === typeName; });
        return match !== undefined;
    };

    var generateGithubIssue = function generateGithubIssue(issues, callback, masterCallback) {
        var issue = issues.pop();
        console.log(' - ' + issue.typeName + ':' + issue.key );

        if(validIssueTypeForImport(issue.typeName)) {
            var ghissue = getGhIssueFor(issue);
            if(ghissue) {
                console.log('\t- Already exists');
                generateGithubIssues(issues, null, masterCallback);
            } else {
                createGhIssue(issue, function(error) {
                    generateGithubIssues(issues, null, masterCallback);
                });
            }
        } else {
            console.log('\t- Ignored');
            generateGithubIssues(issues, null, masterCallback);
        }
    };

    var generateGithubIssues = function generateGithubIssues(issues, callback, masterCallback) {
        if(_.isEmpty(issues) ) {
            masterCallback(null);
        } else {
            generateGithubIssue(issues, generateGithubIssues, masterCallback);
        }
    };

    var addJiraSubtasks = function addJiraSubtasks(issue, callback) {
        context.api.jira.default.findIssue(issue.key, function getIssue(error, completeIssue) {
            _.each(completeIssue.fields.subtasks, function(subtask) {
                subtask.typeName = subtask.fields.issuetype.name;
                subtask.summary = subtask.fields.summary;
                subtask.priorityName = subtask.fields.priority.name;
                subtask.parent = completeIssue;
            });
            context.subIssues = _.union(context.subIssues, completeIssue.fields.subtasks);
            callback(error, completeIssue);
        });
    };

    var createJiraTasksOnGithub = function createJiraTasksOnGithub(callback) {
        context.api.jira.greenhopper.getSprintIssues(context.rapidView.id, context.sprint.id, function(error, result) {
            errorLog(error);
            var masterIssues = _.union(result.contents.completedIssues, result.contents.incompletedIssues);
            context.subIssues = [];

            async.each(masterIssues, addJiraSubtasks, function completed(err) {
                context.jiraOpenIssues = _.union(result.contents.incompletedIssues, context.subIssues);
                var issues = _.union(result.contents.incompletedIssues, context.subIssues); // clone
                console.log('Sprint issues: ' + context.jiraOpenIssues.length);
                generateGithubIssues(issues, null, callback);
            });
        });
    };

    var getJiraIssueFor = function getJiraIssue(ghIssue) {
        return _.find(context.jiraOpenIssues, function iter(jiraIssue) {
            return ghIssue.title.match('^' + jiraIssue.key + ':');
        });
    };

    var closeJiraTask = function closeJiraTask(ghIssue, callback) {
        var jiraIssue = getJiraIssueFor(ghIssue);
        if(!jiraIssue) {
            // already closed
            return;
        }

        context.api.jira.default.listTransitions(jiraIssue.key, function(error, body){
            if(error){
                callback(error)
            }

            _.each(body, function(transitionType){
                if(transitionType.id === '5'){
                    var msg = {
                        transition : transitionType
                    };
                    context.api.jira.default.transitionIssue(jiraIssue.key, msg, function (error) {
                        console.log(' - ' + ghIssue.number + ' -> ' + ghIssue.title);
                        if(error){
                            console.log('\t * ' + error);
                        } else {
                            console.log('\t - Resolved');
                        }
                    });
                }
            })
        });
    };

    var closeJiraTasks = function closeJiraTasks(callback) {
        async.each(context.ghClosedIssues, closeJiraTask, callback);
    };

    var processSubTasks = function processSubTasks(callback) {
        _.each(context.subIssues, function(subtask) {
            var subIssue = getGhIssueFor(subtask);
            var body = (subtask.parent)? 'Sub-Task of #' + getGhIssueFor(subtask.parent).number : 'Sub-Task';
            var comment = [];
            var msg = {
                headers: {
                    authorization: 'Basic ' + new Buffer(context.config.github.auth.username + ":" + context.config.github.auth.password, "ascii").toString("base64"),
                    'content-type': 'application/json'
                },
                repo: context.config.github.repo,
                user: context.config.github.user,
                number: subIssue.number
            };

            context.api.github.issues.getComments(msg, function afterRequest(e, r){
                comment = _.where(r, {body: body});

                if(comment.length == 0){
                    var msg = _.extend({
                        body: body
                    }, msg);
                    context.api.github.issues.createComment(msg, function afterRequest(e, r, body) {
                        console.log('\t-Linked Sub-Task');
                        callback(e);
                    });
                }
            })
        });
    };

    exports.process = function process(config) {
        context.config = config;
        context.api = configApis(config);
        async.series([
            getCurrentSprint,
            getGithubIssues,
            getClosedGithubIssues,
            createJiraTasksOnGithub,
            closeJiraTasks,
            processSubTasks
        ], errorLog);
    };
})();
