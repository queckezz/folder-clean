
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { dissoc, merge, groupBy } = require('ramda')
const { differenceInDays } = require('date-fns')
const { reduce } = require('asyncro')
const { join } = require('path')

const itemTypes = {
  DELETE: Symbol('DELETE'),
  RETAIN: Symbol('RETAIN'),
  DIR: Symbol('DIR'),
  DELETE_DIR: Symbol('DELETE_DIR')
}

const ItemType = (type, stats, path) => ({ type, path })

const getItemAction = async (fullPath, deleteDate, maxAge) => {
  const stats = await stat(fullPath)

  if (stats.isFile()) {
    return maxAge <= differenceInDays(deleteDate, stats.mtime)
      ? ItemType(itemTypes.DELETE, stats, fullPath)
      : ItemType(itemTypes.RETAIN, stats, fullPath)
  } else {
    return ItemType(itemTypes.DIR, stats, fullPath)
  }
}

const getFolderActions = async (path, { deleteAt, maxAge, recursive }) => {
  const directoryContents = await readdir(path)

  const actions = await Promise.all(directoryContents.map(async (item) => {
    const action = await getItemAction(join(path, item), deleteAt, maxAge)
    if (recursive && action.type === itemTypes.DIR) {
      const dirActions = await getFolderActions(action.path, { deleteAt, maxAge, recursive })

      return dirActions.every(({ type }) => type === itemTypes.DELETE)
        ? { type: itemTypes.DELETE_DIR, path: action.path, actions: dirActions }
        : { type: itemTypes.DIR, path: action.path, actions: dirActions }
    }

    return action
  }))

  return actions
}

const executeActions = (actions, deleteEmptyFolders) => {
  return reduce(actions, async (acc, action) => {
    if (action.type === itemTypes.DELETE) {
      try {
        await unlink(action.path)
        return acc
      } catch (e) {
        if (e.code !== 'EBUSY') return acc
        return acc.concat([ItemType(itemTypes.BUSY, action.stats, action.path)])
      }
    } else if (action.type === itemTypes.DIR) {
      return executeActions(action.actions, deleteEmptyFolders)
    } else if (action.type === itemTypes.DELETE_DIR) {
      const busyFiles = await executeActions(action.actions, deleteEmptyFolders)
      if (busyFiles.length === 0) await rmdir(action.path)
      return acc.concat(busyFiles)
    }

    return acc
  }, [])
}

const flattenActions = (actions) => {
  return actions.reduce((acc, action) => {
    switch (action.type) {
      case itemTypes.DIR:
      case itemTypes.DELETE_DIR:
        return acc
          .concat(action.actions)
          .concat([dissoc('actions', action)])
      default:
        return acc.concat([action])
    }
  }, [])
}

const sortByType = (actions) => {
  return groupBy(
    ({ type }) => {
      switch (type) {
        case itemTypes.DELETE:
        case itemTypes.DELETE_DIR:
          return 'delete'
        case itemTypes.RETAIN:
        case itemTypes.DIR:
          return 'retain'
        case itemTypes.BUSY:
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
  const busyFiles = await executeActions(actions, config.deleteEmptyFolders) || []

  return sortByType(actions.concat(busyFiles))
}

module.exports = {
  getFolderActions,
  flattenActions,
  executeActions,
  sortByType,
  itemTypes,
  clean
}