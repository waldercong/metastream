import { Middleware, MiddlewareAPI, Action, Dispatch } from 'redux'
import deepDiff from 'deep-diff'
import { clone } from 'utils/object'

import { NetServer, NetConnection } from 'renderer/network'
import { ReplicatedState } from 'renderer/network/types'
import { NetMiddlewareOptions, NetActions } from 'renderer/network/actions'
import { isType } from 'utils/redux'

export const NetReduxActionTypes = {
  UPDATE: '@@net/UPDATE'
}

const NetActionTypes = {
  FULL_UPDATE: 'FULL_UPDATE',
  UPDATE: 'UPDATE'
}

interface NetPayload {
  type: string

  /** Version */
  v: number

  /** Diff */
  d: deepDiff.IDiff[]
}

const SYNC_HEADER = 'SYNC'

/** Redux subtree replication */
const replicationPrefilter = <T>(state: ReplicatedState<T>): deepDiff.IPrefilter => (path, key) => {
  let i = 0
  let tree: ReplicatedState<any> = state

  // traverse path in tree
  while (i < path.length) {
    const k = path[i]
    if (tree.hasOwnProperty(k)) {
      const result = tree[k] as boolean | ReplicatedState<T>
      if (typeof result === 'object') {
        tree = result
      } else if (typeof result === 'boolean') {
        return !result
      }
    } else {
      return true // ignore undefined replication path
    }
    i++
  }

  if (tree && tree.hasOwnProperty(key)) {
    const result = tree[key]!
    if (typeof result === 'boolean') {
      return !result
    } else if (typeof result === 'object') {
      return false
    }
  }

  return true // ignore undefined replication path
}

export const netSyncMiddleware = (): Middleware => {
  let COMMIT_NUMBER = 0

  return store => {
    const { dispatch, getState } = store

    let server: NetServer | null, host: boolean, prefilter: deepDiff.IPrefilter

    const init = (options: NetMiddlewareOptions) => {
      server = options.server
      host = options.host

      prefilter = replicationPrefilter(options.replicated)
      console.log('[Net] Init netSync', options)

      if (host) {
        server.on('connect', (conn: NetConnection) => {
          conn.once('authed', () => {
            const state = getReplicatedState()
            const action = { type: NetActionTypes.FULL_UPDATE, v: COMMIT_NUMBER, state }
            const jsonStr = JSON.stringify(action)
            const buf = new Buffer(SYNC_HEADER + jsonStr)
            server!.sendTo(conn.id.toString(), buf)
          })
        })
      }

      // Apply diffs on connected clients
      server.on('data', (conn: NetConnection, data: Buffer) => {
        if (data.indexOf(SYNC_HEADER) !== 0) {
          return
        }

        const json = data.toString('utf-8', SYNC_HEADER.length)
        const action = JSON.parse(json)
        console.info(`[Net] Received action #${action.type} from ${conn.id}`, action)

        switch (action.type) {
          case NetActionTypes.FULL_UPDATE:
            COMMIT_NUMBER = action.v

            // Merge at second depth of state
            Object.keys(action.state).forEach(prop => {
              const prevState = (<any>getState())[prop]
              const nextState = Object.assign({}, prevState)
              Object.assign(nextState, action.state[prop])
              Object.assign(getState(), { [prop]: nextState })
            })

            // trigger update noop - forces rerender of applied diff
            dispatch({ type: NetReduxActionTypes.UPDATE })
            break
          case NetActionTypes.UPDATE:
            const diffs = action.d as deepDiff.IDiff[]
            // apply diff to local state
            let state = clone(getState())
            diffs.forEach(diff => {
              deepDiff.applyChange(state, state, diff)
            })
            Object.assign(getState(), state)

            // TODO: Write a redux middleware to apply minimal changes of state tree.
            // Calling `clone` for each networked state update will be bad prob.

            // trigger update noop - forces rerender of applied diff
            dispatch({ type: NetReduxActionTypes.UPDATE })
            break
        }
      })
    }

    const destroy = () => {
      server = null
      COMMIT_NUMBER = 0
    }

    /** Get tree containing only replicated state. */
    const getReplicatedState = () => {
      const state = {}
      const diffs = deepDiff.diff(state, getState(), prefilter)
      if (diffs && diffs.length) {
        diffs.forEach(diff => {
          deepDiff.applyChange(state, state, diff)
        })
      }
      return state
    }

    /** Relay state changes from Server to Clients */
    const relay = (delta: deepDiff.IDiff[]) => {
      // Cleanup diffs to reduce bandwidth
      delta = delta.map(dt => {
        dt = { ...dt }
        if (dt.kind === 'E') {
          delete dt.lhs
        }
        return dt
      })

      console.log('[Net] netSyncMiddleware delta', delta)

      const action: NetPayload = {
        type: NetActionTypes.UPDATE,
        v: COMMIT_NUMBER,
        d: delta
      }

      console.info(`[Net] Sending update #${COMMIT_NUMBER}`, action)

      const jsonStr = JSON.stringify(action)
      const buf = new Buffer(SYNC_HEADER + jsonStr)
      server!.send(buf)
    }

    return next => action => {
      if (isType(action, NetActions.connect)) {
        init(action.payload)
        return next(action)
      } else if (isType(action, NetActions.disconnect)) {
        destroy()
        return next(action)
      }

      if (!host || !server) {
        return next(action)
      }

      const stateA = getState()
      const result = next(action)
      const stateB = getState()

      const delta = deepDiff.diff(stateA, stateB, prefilter)

      if (delta && delta.length > 0) {
        relay(delta)
        COMMIT_NUMBER++
      }

      return result
    }
  }
}
