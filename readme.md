# folder-clean

[![npm version][version-image]][version-url]
[![build status][travis-image]][travis-url]
[![dependency status][david-image]][david-url]
[![license][license-image]][license-url]
[![js standard style][standard-image]][standard-url]
[![downloads per month][downloads-image]][downloads-url]

> Analyzes and potentially deletes all files and folders which are older than a given date. The analyze phase has been seperated from the deletion phase. This has the benefit that we can first display the results before actually deleting them.

## Getting Started

First we'll analyze all items contained in a given folder. Note that this does not delete anything *yet*. In this example we additionally mark empty folders as deletable.

```js
const {
  markEmptyFoldersAsDeletable,
  analyzeFolderRecursive,
  executeActions
} = require('folder-clean')

const { join } = require('path')

const actions = markEmptyFoldersAsDeletable(
  await analyzeFolderRecursive(path, new Date('01/13/2017'), 90)
)
```

Where `actions` contains something like the following.

```js
[
  {
    itemType: Symbol(FILE),
    actionType: Symbol(DELETE),
    path: '~/absolute/path/to/old.txt'
  }, {
    // this would have gotten deleted if we didn't mark
    // empty folders.
    itemType: Symbol(EMPTY_DIR),
    actionType: Symbol(DELETE),
    path: '~/absolute/path/to/empty-folder'
  }, {
    itemType: Symbol(FILE),
    actionType: Symbol(DELETE),
    path: '~/absolute/path/to/sub-folder/old.txt'
  },
    itemType: Symbol(FILE),
    actionType: Symbol(RETAIN),
    path: '~/absolute/path/to/new.txt'
  }, {
    itemType: Symbol(FILE),
    actionType: Symbol(RETAIN),
    path: '~/absolute/path/to/sub-folder/new.txt'
  }, {
    itemType: Symbol(DIR),
    actionType: Symbol(RETAIN),
    path: '~/absolute/path/to/sub-folder'
  }
]
```

After that, execute each given action.

```js
await executeActions(actions)
```

## Installation

    > npm install folder-clean

(or)

    > yarn add folder-clean

## License

[MIT][license-url]

[travis-image]: https://img.shields.io/travis/queckezz/folder-clean.svg?style=flat-square

[travis-url]: https://travis-ci.org/queckezz/folder-clean

[version-image]: https://img.shields.io/npm/v/folder-clean.svg?style=flat-square

[version-url]: https://npmjs.org/package/folder-clean

[downloads-image]: https://img.shields.io/npm/dm/folder-clean.svg?style=flat-square

[downloads-url]: https://npmjs.org/package/folder-clean

[david-image]: http://img.shields.io/david/queckezz/folder-clean.svg?style=flat-square

[david-url]: https://david-dm.org/queckezz/folder-clean

[standard-image]: https://img.shields.io/badge/code-standard-brightgreen.svg?style=flat-square

[standard-url]: https://github.com/feross/standard

[license-image]: http://img.shields.io/npm/l/folder-clean.svg?style=flat-square

[license-url]: ./license
