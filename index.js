
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { dissoc, merge, groupBy } = require('ramda')
const { differenceInDays } = require('date-fns')
const { join } = require('path')

const actionTypes = {
  DELETE: Symbol('DELETE'),
  RETAIN: Symbol('RETAIN'),
  BUSY: Symbol('BUSY')
}

const itemTypes = {
  DIR: Symbol('DIR'),
  FILE: Symbol('FILE')
}

module.exports = {
  getFolderActions,
  flattenActions,
  executeActions,
  actionTypes,
  sortByType,
  itemTypes,
  clean
}

/**
 * Deletes all files in a folder which are older than a given date. It returns
 * a detailed report of which files have been **kept** or **deleted**. You can
 * recursively delete and decide if you want to keep empty folders.
 *
 * @param {string} path - Absolute path
 * @param {Object} [config]
 * @param {Boolean} [config.recursive=false] - Whether to go through all sub folders or not
 * @param {Boolean} [config.deleteEmptyFolders=false] - Whether to delete empty sub folders or not
 * @param {Number} [config.maxAge=90] - Max age which determines how long a file will be kept until deleting it
 * @returns {Promise<Object>} - Set of actions which have been executed
 *
 * @example
 * clean('~/some/folder', { recursive: true })
 *   .then((actions) => {
 *     // ~/some/folder cleaned
 *   })
 */

async function clean (path, _config) {
  const config = merge({
    deleteEmptyFolders: false,
    deleteAt: new Date(),
    recursive: false,
    maxAge: 90
  }, _config)

  const actions = await getFolderActions(path, config)
  await executeActions(actions)
  return sortByType(actions)
}

/**
 * Returns an array of actions of how the folder should be cleaned. This just
 * creates a report and does not delete anything. Each directory item in the
 * array can have another set of actions.
 *
 * @param {string} path - Absolute path
 * @param {Object} [config]
 * @param {Date} deleteAt - Date of when the deletion should happen (can be in the past of course)
 * @param {Boolean} [config.recursive=false] - Whether to go through all sub folders or not
 * @param {Boolean} [config.deleteEmptyFolders=false] - Whether to delete empty sub folders or not
 * @param {Number} [config.maxAge=90] - Max age which determines how long a file will be kept until deleting it
 * @returns {Array} actions - Actions to be executed by `executeActions`
 *
 * @example
 * const actions = await getFolderActions('~/some/folder', {
 *   deleteAt: new Date('11/14/2016'),
 *   recursive: false,
 *   maxAge: 90
 * })
 */

async function getFolderActions (
  path,
  { deleteAt, maxAge, recursive, deleteEmptyFolders }
) {
  const directoryContents = await readdir(path)

  const actions = await Promise.all(directoryContents.map(async (item) => {
    const action = await getItemAction(join(path, item), deleteAt, maxAge)
    if (recursive && action.itemType === itemTypes.DIR) {
      const dirActions = await getFolderActions(
        action.path,
        { deleteAt, maxAge, recursive }
      )

      return isFolderDeletable(dirActions, deleteEmptyFolders)
        ? DirAction(actionTypes.DELETE, action.stats, action.path, dirActions)
        : DirAction(actionTypes.RETAIN, action.stats, action.path, dirActions)
    }

    return action
  }))

  return actions
}

/**
 * Executes each action at filesystem level.
 *
 * @param {Array} actions - Tree-like action set, most likely from `getFolderActions`
 * @returns {undefined}
 *
 * @example
 * await executeActions(await getFolderActions('~/some/folder', options))
 */

async function executeActions (actions) {
  for (let action of actions) {
    if (action.itemType === itemTypes.DIR) {
      await executeActions(action.actions)
    }

    if (action.actionType === actionTypes.DELETE) {
      action.itemType === itemTypes.DIR
        ? await rmdir(action.path)
        : await unlink(action.path)
    }
  }
}

/**
 * Creates an object from an array of actions, sorted by their action type.
 *
 * @param {Array} actions - An array of actions
 * @returns {Object} actions
 */

function sortByType (actions) {
  return groupBy(
    ({ actionType }) => {
      switch (actionType) {
        case actionTypes.DELETE:
          return 'delete'
        case actionTypes.RETAIN:
          return 'retain'
        case actionTypes.BUSY:
          return 'busy'
      }
    },
    flattenActions(actions)
  )
}


/**
 * Flattens each directory in an array of actions down to one level. You'll get
 * an array of actions which includes each **sub action** from any directory and
 * the action for the directory itself.
 *
 * @param {Array} actions - An array of actions
 * @returns {Array} flattenedActions
 */

function flattenActions (actions) {
  return actions.reduce((acc, action) => {
    if (action.itemType === itemTypes.DIR) {
      return acc
        .concat(action.actions)
        .concat([dissoc('actions', action)])
    } else {
      return acc.concat([action])
    }
  }, [])
}

async function getItemAction (fullPath, deleteDate, maxAge) {
  const stats = await stat(fullPath)

  if (stats.isFile()) {
    return maxAge <= differenceInDays(deleteDate, stats.mtime)
      ? FileAction(actionTypes.DELETE, stats, fullPath)
      : FileAction(actionTypes.RETAIN, stats, fullPath)
  } else {
    return DirAction(null, stats, fullPath)
  }
}

function isFolderDeletable (actions, deleteEmptyFolders) {
  const isEmpty = actions.length === 0

  const hasAllDeletableFiles = actions
    .every(({ actionType }) => actionType === actionTypes.DELETE)

  if (!deleteEmptyFolders) {
    return false
  }

  return isEmpty || hasAllDeletableFiles
}

function FileAction (actionType, stats, path) {
  return {
    itemType: itemTypes.FILE,
    actionType,
    path
  }
}

function DirAction (actionType, stats, path, actions) {
  return {
    itemType: itemTypes.DIR,
    actionType,
    path,
    actions
  }
}
