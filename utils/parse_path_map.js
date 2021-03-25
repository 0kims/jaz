module.exports = parsePathMap;

function parsePathMap(pathMap) {
  const result = {};
  const regex = /@(.+)=(.+)/
  for (let i = 0; i < pathMap.length; i ++) {
    const match = pathMap[i].match(regex);
    if (!match) {
        console.log("Invalid --path-map / -a value. Its format should be @alias=path.");
        process.exit(1);
    }
    const alias = match[1];
    const path = match[2];

    if (Object.keys(result).indexOf(alias) !== -1) {
        console.log("Duplicate --path-map / -a value.");
        process.exit(1);
    }

    result[alias] = path;
  }
  return result;
}
