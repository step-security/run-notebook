import * as core from '@actions/core'
import * as fs from 'fs'
import axios, {isAxiosError} from 'axios'
import {runAndAwaitNotebook} from './run-notebook'
import {
  DATABRICKS_RUN_NOTEBOOK_OUTPUT_KEY,
  DATABRICKS_OUTPUT_TRUNCATED_KEY,
  DATABRICKS_RUN_ID_KEY,
  DATABRICKS_RUN_URL_KEY,
  DATABRICKS_TMP_NOTEBOOK_UPLOAD_DIR_STATE_KEY
} from '../../common/src/constants'
import * as utils from '../../common/src/utils'
import {JobRunOutput} from '../../common/src/interfaces'
import {importNotebookIfNeeded} from './import-tmp-notebook'

async function validateSubscription(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'databricks/run-notebook'
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl =
    'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false)
    core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m')
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = {action: action || ''}
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000}
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        '\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m'
      )
      core.error(
        `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`
      )
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}

async function runHelper(): Promise<void> {
  await validateSubscription()

  const databricksHost: string = utils.getDatabricksHost()
  const databricksToken: string = utils.getDatabricksToken()
  const clusterSpec: object = utils.getClusterSpec()
  const librariesSpec: object = utils.getLibrariesSpec()
  const notebookParamsSpec: object = utils.getNotebookParamsSpec()
  const aclSpec: object = utils.getAclSpec()
  const timeoutSpec: object = utils.getTimeoutSpec()
  const runNameSpec: object = utils.getRunNameSpec()
  const gitSourceSpec: object = utils.getGitSourceSpec()

  const nbPath: string = utils.getNotebookPath()
  const workspaceTempDir: string = utils.getWorkspaceTempDir()
  const {notebookPath, tmpNotebookDirectory} = await importNotebookIfNeeded(
    databricksHost,
    databricksToken,
    nbPath,
    workspaceTempDir
  )
  if (tmpNotebookDirectory) {
    core.saveState(
      DATABRICKS_TMP_NOTEBOOK_UPLOAD_DIR_STATE_KEY,
      tmpNotebookDirectory
    )
  }

  const runOutput: JobRunOutput = await runAndAwaitNotebook(
    databricksHost,
    databricksToken,
    notebookPath,
    clusterSpec,
    librariesSpec,
    notebookParamsSpec,
    aclSpec,
    timeoutSpec,
    runNameSpec,
    gitSourceSpec
  )
  if (utils.shouldCommentToPr()) {
    await utils.commentToPr(
      runOutput.notebookOutput.result,
      nbPath,
      runOutput.runUrl
    )
  }

  core.setOutput(
    DATABRICKS_RUN_NOTEBOOK_OUTPUT_KEY,
    runOutput.notebookOutput.result
  )
  core.setOutput(
    DATABRICKS_OUTPUT_TRUNCATED_KEY,
    runOutput.notebookOutput.truncated
  )
  core.setOutput(DATABRICKS_RUN_ID_KEY, runOutput.runId)
  core.setOutput(DATABRICKS_RUN_URL_KEY, runOutput.runUrl)
}

export async function runMain(): Promise<void> {
  await utils.runStepAndHandleFailure(runHelper)
}
