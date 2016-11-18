
const { sortByType, clean, getFolderActions, flattenActions, itemTypes, actionTypes } = require('./')
const { ephemeralFsFromObject } = require('fs-from-object')
const { open, close, stat, utimes } = require('mz/fs')
const cpr = require('recursive-copy')
const { join } = require('path')
const rmfr = require('rmfr')
const test = require('ava')


const setupTree = (task) => {
  const oldFile = { name: 'index-old.txt', contents: 'test', mtime: new Date('06/17/2016') }
  const newFile =  { name: 'index.txt', contents: 'test', mtime: new Date('11/17/2016') }

  const tree = [
    { name: 'basic', contents: [oldFile, newFile] },

    {
      name: 'empty',
      contents: [
        { name: 'empty', contents: [] }
      ]
    },

    {
      name: 'recursive',
      contents: [
        { name: 'sub-folder', contents: [oldFile, newFile] },
        oldFile,
        newFile
      ]
    },

    {
      name: 'empty-after-delete',
      contents: [
        { name: 'sub-folder', contents: [oldFile] }
      ]
    },

    {
      name: 'test-delete',
      contents: [
        { name: 'empty-folder', contents: [] },
        { name: 'sub-folder', contents: [oldFile, newFile] },
        oldFile,
        newFile
      ]
    }
  ]

  return ephemeralFsFromObject(tree, task)
}

test('flat file list', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'basic')

    const actions = await getFolderActions(path, {
      deleteAt: new Date('11/14/2016'),
      recursive: false,
      maxAge: 90
    })
    t.is(actions[0].actionType, actionTypes.DELETE)
    t.is(actions[1].actionType, actionTypes.RETAIN)
  })
})

test('recursive', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'recursive')

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
})

test('empty folders', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'empty')

    const actions = await getFolderActions(path, {
      deleteAt: new Date('11/14/2016'),
      recursive: true,
      maxAge: 90
    })

    t.is(actions[0].itemType, itemTypes.DIR)
    t.is(actions[0].actionType, actionTypes.DELETE)
  })
})

test('empty folders after delete', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'empty-after-delete')

    const actions = await getFolderActions(path, {
      deleteAt: new Date('11/14/2016'),
      recursive: true,
      maxAge: 90
    })

    t.is(actions[0].actionType, actionTypes.DELETE)
    t.is(actions[0].actions[0].actionType, actionTypes.DELETE)
  })
})

test('flatten actions', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'recursive')

    const actions = await getFolderActions(path, {
      deleteAt: new Date('11/14/2016'),
      recursive: true,
      maxAge: 90
    })

    const actionsf = flattenActions(actions)
    t.is(actionsf.length, 5)
  })
})

test('sort actions by type', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'recursive')

    const actions = await getFolderActions(path, {
      deleteAt: new Date('11/14/2016'),
      recursive: true,
      maxAge: 90
    })

    const sortedActions = sortByType(actions)
    t.is(sortedActions.delete.length, 2)
    t.is(sortedActions.retain.length, 3)
  })
})

const shouldntExist = (t, path, item) => {
  return stat(join(path, item))
    .then(() => t.fail(`old item ${item} exists`))
    .catch(() => t.pass())
}

const shouldExist = (t, path, item) => {
  return stat(join(path, item))
    .then(() => t.pass())
    .catch(() => t.fail(`old item ${item} doesn\'t exist`))
}

test('execute actions', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'test-delete')

    await clean(path, {
      deleteAt: new Date('11/14/2016'),
      deleteEmptyFolders: true,
      recursive: true,
      maxAge: 90
    })

    await Promise.all([
      shouldntExist(t, path, 'index-old.txt'),
      shouldntExist(t, path, 'sub-folder/index-old.txt'),
      shouldntExist(t, path, 'empty-folder'),

      shouldExist(t, path, 'index.txt'),
      shouldExist(t, path, 'sub-folder/index.txt')
    ])
  })
})


test.skip('busy files', (t) => {
  return setupTree(async (ephemeralPath) => {
    const path = join(ephemeralPath, 'basic')

    const fd = await open(join(path, 'index-old.txt'), 'r+')

    const actions = await clean(path, {
      deleteAt: new Date('11/14/2016'),
      deleteEmptyFolders: true,
      recursive: true,
      maxAge: 90
    })

    console.log(actions)
    await close(fd)
  })
})