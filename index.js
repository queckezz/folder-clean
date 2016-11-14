
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { flatten, merge, groupBy } = require('ramda')
const { differenceInDays } = require('date-fns')
const { join } = require('path')

const itemTypes = {
  DELETE: Symbol('DELETE'),
  RETAIN: Symbol('RETAIN'),
  DIR: Symbol('DIR'),
  EMPTY_DIR: Symbol('EMPTY_DIR')
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
        ? { type: itemTypes.EMPTY_DIR, path: action.path, actions: dirActions }
        : { type: itemTypes.DIR, path: action.path, actions: dirActions }
    }

    return action
  }))

  return actions
}

const executeActions = (actions, deleteEmptyFolders) => {
  return Promise.all(actions.map((action) => {
    switch (action.type) {
      case itemTypes.DELETE:
        return unlink(action.path)
      case itemTypes.DIR:
        return executeActions(action.actions, deleteEmptyFolders)
      case itemTypes.EMPTY_DIR:
        return executeActions(action.actions, deleteEmptyFolders)
          .then(() => rmdir(action.path))
    }
  }))
}

const flattenActions = (actions) => {
  return actions.reduce((acc, action) => {
    switch (action.type) {
      case itemTypes.DIR:
      case itemTypes.EMPTY_DIR:
        return acc.concat(action.actions)
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
          return 'delete'
        case itemTypes.RETAIN:
          return 'retain'
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
  await executeActions(actions, config.deleteEmptyFolders)

  return actions
}

module.exports = {
  getFolderActions,
  flattenActions,
  executeActions,
  sortByType,
  itemTypes,
  clean
}