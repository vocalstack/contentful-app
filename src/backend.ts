import type { BaseAppSDK } from '@contentful/app-sdk'

import type { ActionError, ActionParams, CheckResult, ConnectResult, StatusResult, StopResult, TranscribeResult } from './actions.js'

import { ACTION_IDS } from './actions.js'
import { VocalStackAPIError } from './api.js'

/** What the frontend asks of VocalStack. Only the App Function talks to the API. */
export type Backend = {
  check: () => Promise<CheckResult>
  connect: (args: { code: string; codeVerifier: string; redirectUri: string }) => Promise<ConnectResult>
  status: (recordingId: string) => Promise<StatusResult>
  stop: (recordingId: string) => Promise<StopResult>
  transcribe: (args: { idempotencyKey: string; name: string; url: string }) => Promise<TranscribeResult>
}

/** The app action itself failed (not deployed, timed out, the function threw): worth retrying. */
export class ActionCallError extends Error {}

type CallSys = { error?: { message?: string }; result?: unknown; status: 'failed' | 'processing' | 'succeeded' }

/** Calls the app's actions through the App SDK's CMA client, as the signed-in user. */
export function appActionBackend(sdk: Pick<BaseAppSDK, 'cma'> & { ids: { app?: string } }): Backend {
  const call = async <T>(op: ActionParams['op'], parameters: Omit<ActionParams, 'op'> | Record<string, never>): Promise<T> => {
    let sys: CallSys
    try {
      const res = await sdk.cma.appActionCall.createWithResult({ appActionId: ACTION_IDS[op], appDefinitionId: sdk.ids.app! }, { parameters: { ...parameters, op } })
      sys = res.sys as unknown as CallSys
    } catch (err) {
      throw new ActionCallError(`The VocalStack app function did not answer (${(err as Error).message}).`)
    }
    if (sys.status !== 'succeeded') throw new ActionCallError(sys.error?.message ?? 'The VocalStack app function failed.')
    const result = sys.result as ActionError | T
    if (result && typeof result === 'object' && 'error' in result) {
      const { code, message, status } = (result as ActionError).error
      throw new VocalStackAPIError(status, code, message)
    }
    return result as T
  }
  return {
    check: () => call('status', {}),
    connect: (args) => call('connect', args),
    status: (recordingId) => call('status', { recordingId }),
    stop: (recordingId) => call('stop', { recordingId }),
    transcribe: (args) => call('transcribe', args),
  }
}
