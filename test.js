
const { sortByType, clean, getFolderActions, flattenActions, itemTypes } = require('./')
const { stat, utimes } = require('mz/fs')
const cpr = require('recursive-copy')
const { join } = require('path')
const rmfr = require('rmfr')
const test = require('tape')

test('flat file list', async (t) => {
  const path = join(process.cwd(), 'fixtures/basic')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: false,
    maxAge: 90
  })

  t.equal(actions[0].type, itemTypes.DELETE)
  t.equal(actions[1].type, itemTypes.RETAIN)
  t.end()
})

test('recursive', async (t) => {
  const path = join(process.cwd(), 'fixtures/recursive')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  t.equal(actions[0].type, itemTypes.DELETE)
  t.equal(actions[1].type, itemTypes.RETAIN)
  t.equal(actions[2].type, itemTypes.DIR)

  const dirActions = actions[2].actions
  t.equal(dirActions[0].type, itemTypes.DELETE)
  t.equal(dirActions[1].type, itemTypes.RETAIN)

  t.end()
})

test('empty folders', async (t) => {
  const path = join(process.cwd(), 'fixtures/empty')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  t.equal(actions[0].type, itemTypes.EMPTY_DIR)
  t.end()
})

test('empty folders after delete', async (t) => {
  const path = join(process.cwd(), 'fixtures/empty-after-delete')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  t.equal(actions[0].type, itemTypes.EMPTY_DIR)
  t.equal(actions[0].actions[0].type, itemTypes.DELETE)
  t.end()
})

test('flatten actions', async (t) => {
  const path = join(process.cwd(), 'fixtures/recursive')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  const actionsf = flattenActions(actions)
  t.equal(actionsf.length, 4)
  t.end()
})

test('sort actions by type', async (t) => {
  const path = join(process.cwd(), 'fixtures/recursive')

  const actions = await getFolderActions(path, {
    deleteAt: new Date('11/14/2016'),
    recursive: true,
    maxAge: 90
  })

  const sortedActions = sortByType(actions)
  t.equal(sortedActions.deleted.length, 2)
  t.equal(sortedActions.retained.length, 2)
  t.end()
})

test('actually deletes stuff', async (t) => {
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

  await clean(dest, {
    deleteAt: new Date('11/14/2016'),
    deleteEmptyFolders: true,
    recursive: true,
    maxAge: 90
  })

  await Promise.all([
    stat(join(dest, 'index-old.txt')).catch(t.pass),
    stat(join(dest, 'sub-folder/index-old.txt')).catch(t.pass),
    stat(join(dest, 'empty-folder')).catch(t.pass),

    stat(join(dest, 'index.txt')).catch(t.fail),
    stat(join(dest, 'sub-folder/index.txt')).catch(t.fail),
  ])

  await rmfr(dest)
  t.end()
})
