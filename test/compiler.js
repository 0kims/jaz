const path = require("path");
const fs = require("fs");
const shelljs = require("shelljs");
const expect = require("chai").expect;

describe("compiler tests", function () {
    this.timeout(100000);

    it('should import a path-mapped dependency', function() {
      const r1csFile = "test." + Date.now().toString() + ".r1cs";
      if (fs.existsSync(r1csFile)) {
        console.error("Please delete " + r1csFile + " before running this test");
        return;
      }
      const cliPath = path.join(__dirname, "..", "cli.js");
      const cmd = "node " + cliPath + " ./test/circuits/pathMap.circom -a @customlib=./test/circuits/ -r " + r1csFile;
      shelljs.exec(cmd);
      expect(fs.existsSync(r1csFile)).to.equal(true);
      fs.unlinkSync(r1csFile);
    });
});
