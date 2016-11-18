
const { rmdir, unlink, readdir, stat } = require('mz/fs')
const { dissoc, merge, groupBy } = require('ramda')
const { differenceInDays } = require('date-fns')
const { reduce } = require('asyncro')
const { join } = require('path')

const actionTypes = {
  DELETE: Symbol('DELETE'),
  RETAIN: Symbol('RETAIN'),
  BUSY: Symbol('BUSy')
}

const itemTypes = {
  DIR: Symbol('DIR'),
  FILE: Symbol('FILE')
}

const FileAction = (actionType, stats, path) => ({ itemType: itemTypes.FILE, actionType, path })
const DirAction = (actionType, stats, path, actions) => ({ itemType: itemTypes.DIR, actionType, path, actions })

const getItemAction = (fullPath, deleteDate, maxAge) => __async(function*() {
  const stats = yield stat(fullPath)

  if (stats.isFile()) {
    return maxAge <= differenceInDays(deleteDate, stats.mtime)
      ? FileAction(actionTypes.DELETE, stats, fullPath)
      : FileAction(actionTypes.RETAIN, stats, fullPath)
  } else {
    return DirAction(null, stats, fullPath)
  }
}())

const getFolderActions = (path, { deleteAt, maxAge, recursive }) => __async(function*() {
  const directoryContents = yield readdir(path)

  const actions = yield Promise.all(directoryContents.map((item) => __async(function*() {
    const action = yield getItemAction(join(path, item), deleteAt, maxAge)
    if (recursive && action.itemType === itemTypes.DIR) {
      const dirActions = yield getFolderActions(action.path, { deleteAt, maxAge, recursive })

      return dirActions.every(({ actionType }) => actionType === actionTypes.DELETE)
        ? DirAction(actionTypes.DELETE, action.stats, action.path, dirActions)
        : DirAction(actionTypes.RETAIN, action.stats, action.path, dirActions)
    }

    return action
  }())))

  return actions
}())

const executeActions = (actions, deleteEmptyFolders) => {
  return reduce(actions, (acc, action) => __async(function*() {
    if (action.actionType !== actionTypes.DELETE) {
      return action.itemType === itemTypes.DIR
        ? executeActions(action.actions, deleteEmptyFolders)
        : acc
    }

    if (action.itemType === itemTypes.DIR) {
      const busyFiles = yield executeActions(action.actions, deleteEmptyFolders)
      if (busyFiles.length === 0) yield rmdir(action.path)
      return acc.concat(busyFiles)
    } else {
      try {
        yield unlink(action.path)
        return acc
      } catch (e) {
        if (e.code !== 'EBUSY') return acc
        return acc.concat([FileAction(itemTypes.BUSY, action.stats, action.path)])
      }
    }
  }()), [])
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

const clean = (path, _config) => __async(function*() {
  const config = merge({
    deleteEmptyFolders: false,
    deleteAt: new Date(),
    recursive: false,
    maxAge: 90
  }, _config)

  const actions = yield getFolderActions(path, config)
  const busyFiles = yield executeActions(actions, config.deleteEmptyFolders)

  return sortByType(actions.concat(busyFiles))
}())

module.exports = {
  getFolderActions,
  flattenActions,
  executeActions,
  actionTypes,
  sortByType,
  itemTypes,
  clean
}
function __async (g) { return new Promise(function (s, j) { function c (a, x) { try { var r = g[x ? 'throw' : 'next'](a) } catch (e) { j(e); return }r.done ? s(r.value) : Promise.resolve(r.value).then(c, d) } function d (e) { c(e, 1) }c() }) }
