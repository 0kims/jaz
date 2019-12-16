#!/usr/bin/env node

/*
    Copyright 2018 0KIMS association.

    This file is part of circom (Zero Knowledge Circuit Compiler).

    circom is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    circom is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with circom. If not, see <https://www.gnu.org/licenses/>.
*/

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const compiler = require("./src/compiler");

const version = require("./package").version;

const argv = require("yargs")
    .version(version)
    .usage("circom [input source circuit file] -o [output definition circuit file] -c [output c file]")
    .alias("o", "output")
    .alias("c", "csource")
    .alias("s", "sym")
    .alias("r", "r1cs")
    .help("h")
    .alias("h", "help")
    .option("verbose", {
        alias: "v",
        type: "boolean",
        description: "Run with verbose logging"
    })
    .option("fast", {
        alias: "f",
        type: "boolean",
        description: "Do not optimize constraints"
    })
    .epilogue(`Copyright (C) 2018  0kims association
    This program comes with ABSOLUTELY NO WARRANTY;
    This is free software, and you are welcome to redistribute it
    under certain conditions; see the COPYING file in the official
    repo directory at  https://github.com/iden3/circom `)
    .argv;


let inputFile;
if (argv._.length == 0) {
    inputFile = "circuit.circom";
} else if (argv._.length == 1) {
    inputFile = argv._[0];
} else  {
    console.log("Only one circuit at a time is permited");
    process.exit(1);
}

const fullFileName = path.resolve(process.cwd(), inputFile);
const fileName = path.basename(fullFileName, ".circom");
const cSourceName = typeof(argv.csource) === "string" ?  argv.csource : fileName + ".cpp";
const r1csName = typeof(argv.r1cs) === "string" ?  argv.r1cs : fileName + ".r1cs";
const symName = typeof(argv.sym) === "string" ?  argv.sym : fileName + ".sym";

const options = {};
options.reduceConstraints = !argv.fast;
options.verbose = argv.verbose || false;
if (argv.csource) {
    options.cSourceWriteStream = fs.createWriteStream(cSourceName);
}
if (argv.r1cs) {
    options.r1csFileName = r1csName;
}
if (argv.sym) {
    options.symWriteStream = fs.createWriteStream(symName);
}

compiler(fullFileName, options).then( () => {
    let cSourceDone = false;
    let symDone = false;
    if (options.cSourceWriteStream) {
        options.cSourceWriteStream.end(() => {
            cSourceDone = true;
            finishIfDone();
        });
    } else {
        cSourceDone = true;
    }
    if (options.symWriteStream) {
        options.symWriteStream.end(() => {
            symDone = true;
            finishIfDone();
        });
    } else {
        symDone = true;
    }
    function finishIfDone() {
        if ((cSourceDone)&&(symDone)) {
            setTimeout(() => {
                process.exit(0);
            }, 300);
        }
    }
}, (err) => {
//    console.log(err);
    console.log(err.stack);
    if (err.pos) {
        console.error(`ERROR at ${err.errFile}:${err.pos.first_line},${err.pos.first_column}-${err.pos.last_line},${err.pos.last_column}   ${err.errStr}`);
    } else {
        console.log(err.message);
        if (argv.verbose) console.log(err.stack);
    }
    if (err.ast) {
        console.error(JSON.stringify(err.ast, null, 1));
    }
    process.exit(1);
});




