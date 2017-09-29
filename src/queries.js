'use strict'

const node = require('./graphql').queryNode
// const send = require('./graphql').executequery

/// //
// Queries
/// //

const pagination = [
  node('totalCount'),
  node('pageInfo').addChild(node('endCursor'))
]

const authoredQ = node('nodes')
      .addChild(node('id'))
      .addChild(node('author')
                .addChild(node('login'))
                .addChild(node('... on User')
                          .addChild(node('name'))))
      .addChild(node('createdAt'))

const participantsQ = authoredQ
      .addChild(node('comments', {first: 100}, pagination)
                .addChild(authoredQ))

const commentsQ = pagination.concat([participantsQ])

const prsIssuesQ = [
  node('pullRequests', {first: 100}, commentsQ),
  node('issues', {first: 100}, commentsQ)
]

/** Returns a query to retrieve all contributors to a repo */
const repository = (repoName, ownerName) =>
      node('repository', {name: repoName, owner: ownerName}, prsIssuesQ)

/** Returns a query which retrieves names of all repos from an organisation. */
const organization = name =>
      node('organization', {login: name})
      .addChild(node('id'))
      .addChild(node('repositories', {first: 100}, pagination)
                .addChild(node('nodes')
                          .addChild(node('name'))))

const orgRepos = name =>
      node('organization', {login: name})
      .addChild(node('id'))
      .addChild(node('repositories', {first: 25}, pagination)
                .addChild(node('nodes', {}, prsIssuesQ)))

const userRepos = login =>
      node('user', {login})
      .addChild(node('id'))
      .addChild(node('repositories', {first: 100}, pagination))

const continuationQuery = (id, parentType, childType, cursor, n, query) =>
      node('node', {id})
      .addChild(node(`... on ${parentType}`)
                .addChild(node(childType, {after: cursor, first: n})
                          .addChild(node('nodes', {}, query))))

/// //
// Data Filtering (co-queries if you will)
/// //

const cursorData = (x, key, fetched) => {
  return {
    id: x.id,
    cursor: x[key].pageInfo.endCursor,
    rem: Math.max(0, x[key].totalCount - fetched)
  }
}

const checkAllRepo = async ({token, data}) => {
  const prcs = data.pullRequests.nodes
        .map(x => cursorData(x, 'comments', 100))
        .filter(x => x.rem > 0)

  const issuescs = data.issues.nodes
        .map(x => cursorData(x, 'comments', 100))
        .filter(x => x.rem > 0)

  console.log(prcs, issuescs)

  return data
}

/** Returns a function that when given an array of objects with createAt keys,
  * returns an array containing only those objects created between before and
  * after.
  */
const timeFilter = (before = new Date(), after = new Date(0)) =>
      data => data.filter(x => {
        const date = new Date(x.createdAt)
        return after <= date && date <= before
      })

const users = arr =>
  arr.map(x => x.author)
      // Get rid of null authors (deleted accounts)
      .filter(x => !(x === null || undefined === x))
      .map(x => [x.login, x.name])

/** Returns an array which is the concatenation of arrays in the passed in
  * array.
  */
const flatten = arr => arr.reduce((acc, next) => acc.concat(next), [])

const comments = x => flatten(x.map(x => x.comments.nodes))

/** Given an array of arrays of length 2, returns an array of pairs where each
  * first element occurs at most once.
  */
const uniquify = xs => Array.from(new Map(xs).entries())

/** Parse repository query result and filter for date range. */
const cleanRepo = (result, before, after) => {
  const tf = timeFilter(before, after)
  const process = x => uniquify(users(tf(x)))

  const prs = result.pullRequests.nodes
  const issues = result.issues.nodes

  return {
    prCreators: process(prs),
    prCommentators: process(comments(prs)),
    issueCreators: process(issues),
    issueCommentators: process(comments(issues))
  }
}

const mergeArrays = (a, b) =>
      uniquify(a.concat(b))

/** Recursively merges all contributor maps in the list into a single map */
const mergeRepoResults = repos =>
      repos.reduce((
        acc, {
          prCreators,
          prCommentators,
          issueCreators,
          issueCommentators
        }
      ) => {
        return {
          prCreators: mergeArrays(acc.prCreators, prCreators),
          prCommentators: mergeArrays(acc.prCommentators, prCommentators),
          issueCreators: mergeArrays(acc.issueCreators, issueCreators),
          issueCommentators: mergeArrays(acc.issueCommentators, issueCommentators)
        }
      }, {
        prCreators: [],
        prCommentators: [],
        issueCreators: [],
        issueCommentators: []
      })

/** Returns a flat list of repo names given the result of the organizations
  * query.
  */
const cleanOrgNames = data =>
      flatten(data.organization.repositories.nodes)
      .map(x => x.name)

const cleanOrgRepos = (data, before, after) => {
  const repos = data.organization.repositories.nodes
  return mergeRepoResults(repos.map(repo => cleanRepo(repo, before, after)))
}

const cleanUserRepos = x => x
//  const repos = x.repositories.totalCount;
//  if (c <= 100) {
//    return x
//  } else {

module.exports = {
  repository,
  organization,
  orgRepos,
  cleanOrgRepos,
  cleanOrgNames,
  timeFilter,
  uniquify,
  flatten,
  users,
  cleanRepo,
  mergeRepoResults,
  authoredQ,
  userRepos,
  cleanUserRepos,
  continuationQuery,
  commentsQ,
  prsIssuesQ,
  checkAllRepo
}
