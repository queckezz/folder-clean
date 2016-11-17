
const { sortByType, clean, getFolderActions, flattenActions, itemTypes, actionTypes } = require('./')
const { open, close, stat, utimes } = require('mz/fs')
const cpr = require('recursive-copy')
const { join } = require('path')
const rmfr = require('rmfr')
const test = require('ava')

test('flat file list', async (t) => {
  const path = join(process.cwd(), 'fixtures/basic')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: false,
    maxAge: 90
  })
  t.is(actions[0].actionType, actionTypes.DELETE)
  t.is(actions[1].actionType, actionTypes.RETAIN)
})

test('recursive', async (t) => {
  const path = join(process.cwd(), 'fixtures/recursive')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  t.is(actions[0].actionType, actionTypes.DELETE)
  t.is(actions[1].actionType, actionTypes.RETAIN)

  const dir = actions[2]
  t.is(dir.itemType, itemTypes.DIR)
  t.is(dir.actions[0].actionType, actionTypes.DELETE)
  t.is(dir.actions[1].actionType, actionTypes.RETAIN)
})

test('empty folders', async (t) => {
  const path = join(process.cwd(), 'fixtures/empty')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  t.is(actions[0].itemType, itemTypes.DIR)
  t.is(actions[0].actionType, actionTypes.DELETE)
})

test('empty folders after delete', async (t) => {
  const path = join(process.cwd(), 'fixtures/empty-after-delete')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  t.is(actions[0].actionType, actionTypes.DELETE)
  t.is(actions[0].actions[0].actionType, actionTypes.DELETE)
})

test('flatten actions', async (t) => {
  const path = join(process.cwd(), 'fixtures/recursive')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  const actionsf = flattenActions(actions)
  t.is(actionsf.length, 5)
})

test('sort actions by type', async (t) => {
  const path = join(process.cwd(), 'fixtures/recursive')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  const sortedActions = sortByType(actions)
  t.is(sortedActions.delete.length, 2)
  t.is(sortedActions.retain.length, 3)
})

const shouldntExist = (t, dest, item) => {
  return stat(join(dest, item))
    .then(() => t.fail(`old item ${item} exists`))
    .catch(() => t.pass())
}

const shouldExist = (t, dest, item) => {
  return stat(join(dest, item))
    .then(() => t.pass())
    .catch(() => t.fail(`old item ${item} doesn\'t exist`))
}

test('execute actions', async (t) => {
  const src = join(process.cwd(), 'fixtures/test-delete')
  const dest = join(process.cwd(), 'fixtures/test-delete-copy')
  const files = await cpr(src, dest)

  // recursive copy doesn't keep mtime so we set it for each old document
  await Promise.all(files.map(({ dest, stats }) => {
    const t = new Date('07/14/2016')
    if (stats.isFile() && dest.indexOf('index-old.txt') !== -1) {
      return utimes(dest, t, t)
    } else {
      return Promise.resolve()
    }
  }))

  const busyFiles = await clean(dest, {
    deleteAt: new Date('11/14/2016'),
    deleteEmptyFolders: true,
    recursive: true,
    maxAge: 90
  })

  await Promise.all([
    shouldntExist(t, dest, 'index-old.txt'),
    shouldntExist(t, dest, 'sub-folder/index-old.txt'),
    shouldntExist(t, dest, 'empty-folder'),

    shouldExist(t, dest, 'index.txt'),
    shouldExist(t, dest, 'sub-folder/index.txt')
  ])

  await rmfr(dest)
})


test.skip('busy files', async (t) => {
  const path = join(process.cwd(), 'fixtures/basic')

  const fd = await open(join(path, 'index-old.txt'), 'r+')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: false,
    maxAge: 90
  })

  console.log(actions)
  await close(fd)
})