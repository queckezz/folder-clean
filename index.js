
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { dissoc, merge, groupBy } = require('ramda')
const { differenceInDays } = require('date-fns')
const { reduce } = require('asyncro')
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

const FileAction = (actionType, stats, path) =>
  ({ itemType: itemTypes.FILE, actionType, path })

const DirAction = (actionType, stats, path, actions) =>
  ({ itemType: itemTypes.DIR, actionType, path, actions })

const isFolderDeletable = (actions) =>
  actions.every(({ actionType }) => actionType === actionTypes.DELETE)

const getItemAction = async (fullPath, deleteDate, maxAge) => {
  const stats = await stat(fullPath)

  if (stats.isFile()) {
    return maxAge <= differenceInDays(deleteDate, stats.mtime)
      ? FileAction(actionTypes.DELETE, stats, fullPath)
      : FileAction(actionTypes.RETAIN, stats, fullPath)
  } else {
    return DirAction(null, stats, fullPath)
  }
}

const getFolderActions = async (path, { deleteAt, maxAge, recursive }) => {
  const directoryContents = await readdir(path)

  const actions = await Promise.all(directoryContents.map(async (item) => {
    const action = await getItemAction(join(path, item), deleteAt, maxAge)
    if (recursive && action.itemType === itemTypes.DIR) {
      const dirActions = await getFolderActions(
        action.path,
        { deleteAt, maxAge, recursive }
      )

      return isFolderDeletable(dirActions)
        ? DirAction(actionTypes.DELETE, action.stats, action.path, dirActions)
        : DirAction(actionTypes.RETAIN, action.stats, action.path, dirActions)
    }

    return action
  }))

  return actions
}

const executeActions = (actions, deleteEmptyFolders) => {
  return reduce(actions, async (acc, action) => {
    if (action.actionType !== actionTypes.DELETE) {
      return action.itemType === itemTypes.DIR
        ? executeActions(action.actions, deleteEmptyFolders)
        : acc
    }

    if (action.itemType === itemTypes.DIR) {
      const busyFiles = await executeActions(action.actions, deleteEmptyFolders)
      if (busyFiles.length === 0) await rmdir(action.path)
      return acc.concat(busyFiles)
    } else {
      try {
        await unlink(action.path)
        return acc
      } catch (e) {
        if (e.code !== 'EBUSY') return acc
        return acc.concat([
          FileAction(itemTypes.BUSY, action.stats, action.path)
        ])
      }
    }
  }, [])
}

const flattenActions = (actions) => {
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

const sortByType = (actions) => {
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

const clean = async (path, _config) => {
  const config = merge({
    deleteEmptyFolders: false,
    deleteAt: new Date(),
    recursive: false,
    maxAge: 90
  }, _config)

  const actions = await getFolderActions(path, config)
  const busyFiles = await executeActions(actions, config.deleteEmptyFolders)

  return sortByType(actions.concat(busyFiles))
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
