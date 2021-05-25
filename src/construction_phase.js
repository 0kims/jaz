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

/*

    The exec functions, return an object of the form:

    {
        t: "C" or "V" or "S"
        s: Accumulated Sizes
        v: [] only when "V" Array of values where each value is:
            {
                t: "N", "S", "LC", "QEX", "NQ"
                v: When "N" its the bigInt of the number
                coefs: { sIdx: vCoef } when "LC" the values of the coefs
                a,b,c: a LC object of a quadratic expression.
            }
        refId: In case of a variable, the reference of a variable.
        sIdx: When signal, the sIdx
        cIdx: When component, the cIdx
    }





 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");

const iterateAST = require("./iterateast");
const utils = require("./utils");

const LCAlgebra = require("./lcalgebra");
const parser = require("../parser/jaz.js").parser;
const Scalar = require("ffjavascript").Scalar;

const {stringifyBigInts} = require("ffjavascript").utils;

/* TODO: Add lines information

function setLines(dst, first, last) {
    last = last || first;
    dst.first_line = first.first_line;
    dst.first_column = first.first_column;
    dst.last_line = last.last_line;
    dst.last_column = last.last_column;
}
*/

module.exports = constructionPhase;

const NQVAL = {t: "V", s:[1,0], v: [{t:"NQ"}]};

function constructionPhase(ctx, srcFile) {

    const fullFileName = srcFile;
    const fullFilePath = path.dirname(fullFileName);

    const src = fs.readFileSync(fullFileName, "utf8");
    ctx.ast = parser.parse(src);

    assert(ctx.ast.type == "BLOCK");

    ctx.lc = new LCAlgebra(ctx.F);
    ctx.filePath= fullFilePath;
    ctx.fileName= fullFileName;
    ctx.includedFiles = {};
    ctx.includedFiles[fullFileName] = src.split("\n");

    ctx.refs = [];
    createRefs(ctx, ctx.ast);
    exec(ctx, ctx.ast);

}

function exec(ctx, ast) {
    if (!ast) {
        return ctx.throwError(ast, "Null AST");
    }
    if (ast.type == "NUMBER") {
        return execNumber(ctx,ast);
    } else if (ast.type == "VARIABLE") {
        return execVariable(ctx, ast);
    } else if (ast.type == "PIN") {
        return execPin(ctx, ast);
    } else if (ast.type == "OP") {
        if (ast.op == "=") {
            return execAssignement(ctx, ast, false);
        } else if (ast.op == "<--") {
            return execAssignement(ctx, ast,false);
        } else if (ast.op == "<==") {
            return execAssignement(ctx, ast, true);
        } else if (ast.op == "===") {
            return execConstrain(ctx, ast);
        } else if (ast.op == "+=") {
            return execOpOp(ctx, ast, "add", "LEFT");
        } else if (ast.op == "*=") {
            return execOpOp(ctx, ast, "mul", "LEFT");
        } else if (ast.op == "+") {
            return execOp(ctx, ast, "add", 2);
        } else if (ast.op == "-") {
            return execOp(ctx, ast, "sub", 2);
        } else if (ast.op == "UMINUS") {
            return execOp(ctx, ast, "neg", 1);
        } else if (ast.op == "*") {
            return execOp(ctx, ast, "mul", 2);
        } else if (ast.op == "%") {
            return execOp(ctx, ast, "mod", 2);
        } else if (ast.op == "PLUSPLUSRIGHT") {
            return execOpOp(ctx, ast, "add", "RIGHT");
        } else if (ast.op == "PLUSPLUSLEFT") {
            return execOpOp(ctx, ast, "add", "LEFT");
        } else if (ast.op == "MINUSMINUSRIGHT") {
            return execOpOp(ctx, ast, "sub", "RIGHT");
        } else if (ast.op == "MINUSMINUSLEFT") {
            return execOpOp(ctx, ast, "sub", "LEFT");
        } else if (ast.op == "/") {
            return execOp(ctx, ast, "div", 2);
        } else if (ast.op == "\\") {
            return execOp(ctx, ast, "idiv", 2);
        } else if (ast.op == "**") {
            return execOp(ctx, ast, "pow", 2);
        } else if (ast.op == "&") {
            return execOp(ctx, ast, "band", 2);
        } else if (ast.op == "|") {
            return execOp(ctx, ast, "bor", 2);
        } else if (ast.op == "^") {
            return execOp(ctx, ast, "bxor", 2);
        } else if (ast.op == "~") {
            return execOp(ctx, ast, "bnot", 1);
        } else if (ast.op == "&&") {
            return execOp(ctx, ast, "land", 2);
        } else if (ast.op == "||") {
            return execOp(ctx, ast, "lor", 2);
        } else if (ast.op == "!") {
            return execOp(ctx, ast, "lnot", 1);
        } else if (ast.op == "<<") {
            return execOp(ctx, ast, "shl", 2);
        } else if (ast.op == ">>") {
            return execOp(ctx, ast, "shr", 2);
        } else if (ast.op == "<") {
            return execOp(ctx, ast, "lt", 2);
        } else if (ast.op == ">") {
            return execOp(ctx, ast, "gt", 2);
        } else if (ast.op == "<=") {
            return execOp(ctx, ast, "leq", 2);
        } else if (ast.op == ">=") {
            return execOp(ctx, ast, "geq", 2);
        } else if (ast.op == "==") {
            return execOp(ctx, ast, "eq", 2);
        } else if (ast.op == "!=") {
            return execOp(ctx, ast, "neq", 2);
        } else if (ast.op == "?") {
            return execTerCon(ctx, ast);
        } else {
            ctx.throwError(ast, "Invalid operation: " + ast.op);
        }
    } else if (ast.type == "DECLARE") {
        if (ast.declareType == "COMPONENT") {
            return execDeclareComponent(ctx, ast);
        } else if ((ast.declareType == "SIGNALIN")||
                   (ast.declareType == "SIGNALOUT")||
                   (ast.declareType == "SIGNAL")) {
            return execDeclareSignal(ctx, ast);
        } else if (ast.declareType == "VARIABLE") {
            return execDeclareVariable(ctx, ast);
        } else {
            ctx.throwError(ast, "Invalid declaration: " + ast.declareType);
        }
    } else if (ast.type == "FUNCTIONCALL") {
        return execFunctionCall(ctx, ast);
    } else if (ast.type == "BLOCK") {
        return execBlock(ctx, ast);
    } else if (ast.type == "COMPUTE") {
        return execCompute(ctx, ast);
    } else if (ast.type == "FOR") {
        return execLoop(ctx, ast);
    } else if (ast.type == "WHILE") {
        return execLoop(ctx, ast);
    } else if (ast.type == "IF") {
        return execIf(ctx, ast);
    } else if (ast.type == "RETURN") {
        return execReturn(ctx, ast);
    } else if (ast.type == "TEMPLATEDEF") {
        return execTemplateDef(ctx, ast);
    } else if (ast.type == "FUNCTIONDEF") {
        return execFunctionDef(ctx, ast);
    } else if (ast.type == "INCLUDE") {
        return execInclude(ctx, ast);
    } else if (ast.type == "ARRAY") {
        return execArray(ctx, ast);
    } else {
        ctx.throwError(ast, "Invalid AST node type: " + ast.type);
    }
}

function execNumber(ctx, ast) {
    return {
        t: "V",
        s:[1,0],
        v: [{
            t: "N",
            v: ctx.F.e(ast.value)
        }]
    };
}


function execTemplateDef(ctx, ast) {
    ctx.templates[ast.name] = {
        block: ast.block,
        params: ast.params,
        fileName: ctx.fileName,
        filePath: ctx.filePath,
    };
}

function execFunctionDef(ctx, ast) {
    ctx.functions[ast.name] = {
        block: ast.block,
        params: ast.params,
        fileName: ctx.fileName,
        filePath: ctx.filePath
    };
}

function execDeclareComponent(ctx, ast) {
    if (ast.name.type != "VARIABLE") return ctx.throwError( ast, "Invalid component name");

    const sizes=[];
    for (let i=0; i< ast.name.selectors.length; i++) {
        const sizeRef = exec(ctx, ast.name.selectors[i]);
        if (ctx.error) return;

        const size = val(ctx, sizeRef);
        if (size.t != "N") return ctx.throwError(  ast.name.selectors[i], "expected a number");

        sizes.push( Scalar.toNumber(size.v) );
    }

    let cIdx = ctx.addComponent(ast.name.name, sizes);
    if (!Array.isArray(cIdx)) cIdx = [cIdx, cIdx+1];


    ctx.refs[ast.refId].s = utils.accSizes(sizes);
    ctx.refs[ast.refId].cIdx = cIdx[0];

    return ctx.refs[ast.refId];
}


function execDeclareSignal(ctx, ast) {

    if (ast.name.type != "VARIABLE") return ctx.throwError(ast, "Invalid component name");

    const sizes=[];
    for (let i=0; i< ast.name.selectors.length; i++) {
        const size = exec(ctx, ast.name.selectors[i]);
        if (ctx.error) return;
        if (size.s[0] != 1) return ctx.throwError(ast, "Size cannot be an array");
        if (size.v[0].t != "N") return ctx.throwError(ast, "Size must be declared in construction time");
        sizes.push( Scalar.toNumber(size.v[0].v) );
    }

    let sIdx = ctx.addSignal(ast.name.name, sizes);
    if (!Array.isArray(sIdx)) sIdx = [sIdx, sIdx+1];
    for (let i=sIdx[0]; i<sIdx[1]; i++) {
        ctx.signals[i] = {
            o: 0,
            e: -1
        };

        if (ast.declareType == "SIGNALIN") {
            ctx.signals[i].o |= ctx.IN;
            ctx.components[ctx.currentComponent].nInSignals+=1;
        }
        if (ast.declareType == "SIGNALOUT") {
            ctx.signals[i].o |= ctx.OUT;
        }
        if (ast.private ) {
            ctx.signals[i].o |= ctx.PRV;
        }
        if (ctx.main) {
            ctx.signals[i].o |= ctx.MAIN;
        }

        // ctx.components[ctx.currentComponent].signals.push(i);
    }

    const v = ctx.refs[ast.refId];
    v.s = utils.accSizes(sizes);
    v.sIdx = sIdx[0];

    return v;
}

function execDeclareVariable(ctx, ast) {

    if (ast.name.type != "VARIABLE") return ctx.throwError(ast, "Invalid linear combination name");

    const sizes=[];
    for (let i=0; i< ast.name.selectors.length; i++) {
        const size = exec(ctx, ast.name.selectors[i]);
        if (ctx.error) return;
        if (size.s[0] != 1) return ctx.throwError(ast, "Size cannot be an array");
        if (size.v[0].t != "N") return ctx.throwError(ast, "Size must be declared in construction time");
        sizes.push( Scalar.toNumber(size.v[0].v) );
    }

    const v = ctx.refs[ast.refId];

    v.s = utils.accSizes(sizes);
    v.v = new Array(v.s[0]);

    return v;
}

function execAssignement(ctx, ast, isConstraint) {
    let left;
    const leftSels=[];
    if (ast.values[0].type == "DECLARE") {
        left = exec(ctx, ast.values[0]);
        if (ctx.error) return;
    } else if (ast.values[0].type == "PIN") {
        left = execPin(ctx, ast.values[0]);
        if (ctx.error) return;
    } else {
        if (!utils.isDefined(ast.values[0].refId)) return ctx.throwError(ast, "Assigning to a non variable");
        left = ctx.refs[ast.values[0].refId];
        if (ast.values[0].selectors) {
            for (let i=0; i< ast.values[0].selectors.length; i++) {
                const sel = exec(ctx, ast.values[0].selectors[i]);
                if (ctx.error) return;

                if (sel.s[0] != 1) return ctx.throwError(ast, "Selector cannot be an array");
                if (sel.v[0].t != "N") return {t: "NQ"};

                leftSels.push( Scalar.toNumber(sel.v[0].v) );
            }
        }

    }

    if ((!left)||(!left.s)) return ctx.throwError(ast, "variable. not defined yet");

    if (left.t == "C") return execInstantiateComponet(ctx, left, ast.values[1], leftSels);
    if ((left.t == "S")&&( ["<--", "<==", "-->", "==>"].indexOf(ast.op) < 0)) return ctx.throwError(ast, "Cannot assign to a signal with `=` use <-- or <== ops");
    if ((left.t == "V")&&( ["<--", "<==", "-->", "==>"].indexOf(ast.op) >= 0)) return ctx.throwError(ast, `Cannot assign to a var with ${ast.op}. use = op`);

    const right = exec(ctx, ast.values[1]);
    if (ctx.error) return;

    if (!utils.sameSizes(left.s.slice(leftSels.length),right.s)) return ctx.throwError(ast, "Sizes in assignment must be the same");

    let o = 0;
    for (let i=0; i<leftSels.length; i++) o += leftSels[i]*left.s[i+1];
    const leftVals = [];
    if (left.t == "V") {
        if (right.t=="V") {
            for (let i=0; i<right.s[0]; i++) {
                left.v[o+i]=right.v[i];
                leftVals.push(left.v[o+i]);
            }
        } else if (right.t == "S") {
            for (let i=0; i<right.s[0]; i++) {
                left.v[o+i]={t: "LC", coefs: {}};
                left.v[o+i].coefs[right.sIdx+i] = ctx.F.one;
                leftVals.push(left.v[o+i]);
            }
        }
    } else if ( left.t == "S") {
        if (right.t=="V") {
            for (let i=0; i<right.s[0]; i++) {
                const ev = ctx.lc.evaluate(ctx, right.v[i]);
                setSignalValue(left.sIdx + o +i, ev);
                const leftSignal = {
                    t: "LC",
                    coefs: {}
                };
                let sIdx = left.sIdx + o +i;
                while (ctx.signals[sIdx].e >= 0) sIdx = ctx.signals[sIdx].e;
                leftSignal.coefs[sIdx] = ctx.F.one;
                leftVals.push(leftSignal);
            }
        } else if (right.t == "S") {
            for (let i=0; i<right.s[0]; i++) {
                joinSignals(left.sIdx + o + i, right.sIdx + i);
                const leftSignal = {
                    t: "LC",
                    coefs: {}
                };
                let sIdx = left.sIdx + o +i;
                while (ctx.signals[sIdx].e >= 0) sIdx = ctx.signals[sIdx].e;
                leftSignal.coefs[sIdx] = ctx.F.one;
                leftVals.push(leftSignal);
            }
        }
    }

    if (isConstraint) {
        ast.fileName = ctx.fileName;
        ast.filePath = ctx.filePath;
        if (leftVals.length!=1) return ctx.throwError(ast, "Arrays not allowed in constraints");
        const aV = leftVals[0];
        const bV = val(ctx, right, ast.values[1]);

        const res = ctx.lc.sub(aV,bV);
        if (res.type == "NQ") return ctx.throwError(ast, "Non Quadratic constraint");

        if (!ctx.lc.isZero(res)) {
            ctx.constraints.push(ctx.lc.toQEX(res));
            if (ctx.verbose) {
                if ((ctx.constraints.length % 10000 == 0)&&(ctx.constraints.length>0)) console.log("Constraints: " + ctx.constraints.length);
            }
        }
    }

    return right;

    function setSignalValue(dSIdx, v) {
        let sDest = ctx.signals[dSIdx];
        if (!sDest) return ctx.throwError(ast, "Assigning to unexisting signal");

        while (sDest.e>=0) sDest=ctx.signals[sDest.e];

        if (utils.isDefined(sDest.v)) return ctx.throwError(ast, "Signals cannot be assigned twice");

        if (v !== null) {
            sDest.v = v;
        }
    }

    function joinSignals(dIdx, sIdx) {
        let sDest=ctx.signals[dIdx];
        let isOut = (sDest.o & ctx.MAIN)&&(sDest.o & ctx.OUT);
        while (sDest.e>=0) {
            sDest=ctx.signals[sDest.e];
            isOut = isOut || ((sDest.o & ctx.MAIN)&&(sDest.o & ctx.OUT));
        }

        if (utils.isDefined(sDest.v)) return ctx.throwError(ast, "Signals cannot be assigned twice");

        let sSrc = ctx.signals[sIdx];
        let isIn  = (sSrc.o & ctx.MAIN)&&(sSrc.o & ctx.IN);
        while (sSrc.e>=0) {
            sSrc=ctx.signals[sSrc.e];
            isIn = isIn || ((sSrc.o & ctx.MAIN)&&(sSrc.o & ctx.IN));
        }

        // Skip if an out is assigned directly to an input.
        if (!(isIn&&isOut)) {
            if (isIn) {
                sDest.e = sIdx;
            } else if (isOut) {
                sSrc.e = dIdx;
            } else {
                sDest.e = sIdx;
            }
            if (!isOut) {
                if (utils.isDefined(sSrc.v)) sDest.v = sSrc.v;
            }
        }
    }
}



function execInstantiateComponet(ctx, vr, fn, sels) {

    if (fn.type != "FUNCTIONCALL") return ctx.throwError(fn, "Right type of instantiate component must be a function call");

    const templateName = fn.name;

    const template = ctx.templates[templateName];
    if (!template) return ctx.throwError(fn, "Invalid Template");

    const paramValues = [];
    for (let i=0; i< fn.params.length; i++) {
        const v = exec(ctx, fn.params[i]);
        if (ctx.error) return;
        for (let j=0; j<v.s[0]; j++) {
            if (v.v[j].t != "N") ctx.throwError(fn, "Parameters of a template must be constant");
        }
        paramValues.push(v);
    }
    if (template.params.length != paramValues.length) ctx.throwError(fn, "Invalid Number of parameters");

    let o=0;
    for (let i=0; i<sels.length; i++) o += sels[i] * vr.s[i+1];
    for (let i=o; i<o+vr.s[sels.length]; i++) {
        instantiateComponent(vr.cIdx+i);
    }

    function instantiateComponent(cIdx) {

        function extractValue(sizes, arr) {
            if (sizes[0] == 1) return arr[0].v.toString();
            const res = [];
            for (let i=0; i<sizes[0]; i += sizes[1]) {
                res.push(extractValue(sizes.slice(1), arr.slice(i, i+sizes[1])));
            }
            return res;
        }

        if (ctx.components[cIdx]) return ctx.throwError(fn, "Component already instantiated");

        const oldComponent = ctx.currentComponent;
        const oldFileName = ctx.fileName;
        const oldFilePath = ctx.filePath;
        const oldMain = ctx.main;
        const oldRefs = ctx.refs;

        if (ctx.currentComponent==-1) {
            ctx.main=true;
        } else {
            ctx.main=false;
        }

        ctx.currentComponent = cIdx;

        ctx.components[cIdx] = {
            params: {},
            names: ctx.newTableName(),
            nInSignals: 0,
            template: templateName
        };


        if (template.params.length != paramValues.length) return ctx.throwError(fn, "Invalid number of parameters: " + templateName);
        ctx.refs = [];

        const scope = {};
        for (let i=0; i< template.params.length; i++) {
            ctx.refs.push({
                t: "V",
                s: paramValues[i].s,
                v: paramValues[i].v,
                refId: i
            });
            scope[template.params[i]] = i;
            ctx.components[cIdx].params[template.params[i]] = extractValue(paramValues[i].s, paramValues[i].v);
        }

        createRefs(ctx, template.block, scope);

        ctx.fileName = template.fileName;
        ctx.filePath = template.filePath;

        execBlock(ctx, template.block);

        ctx.refs = oldRefs;
        ctx.fileName = oldFileName;
        ctx.filePath = oldFilePath;
        ctx.currentComponent = oldComponent;
        ctx.main = oldMain;
    }
}


function execBlock(ctx,  ast) {
    for (let i=0; i<ast.statements.length; i++) {
        exec(ctx, ast.statements[i]);
        if (ctx.returnValue) return;
        if (ctx.error) return;
    }
}

function clone(a) {
    const res = {
        t: a.t,
        s: a.s
    };
    if (a.t == "V") {
        res.v = new Array(a.v.length);
        for (let i=0; i<a.v.length; i++) res.v[i] = a.v[i];
    } else if (a.t == "S") {
        res.sIdx = a.sIdx;
    } else if (a.t == "C") {
        res.cIdx = a.cIdx;
    }
    return res;
}

function execFunctionCall(ctx, ast) {

    if (ast.name == "log") {
        const v = exec(ctx, ast.params[0]);
        const ev = val(ctx, v, ast);
        if (ev.v) {
            console.log(ev.v.toString());
        } else {
            console.log(JSON.stringify(stringifyBigInts(ev)));
        }
        return;
    }
    if (ast.name == "assert") {
        ast.fileName = ctx.fileName;
        ast.filePath = ctx.filePath;

        const v = exec(ctx, ast.params[0]);
        const ev = val(ctx, v, ast);
        if ((typeof ev.v !== "undefined")&&(ctx.F.isZero(ev.v))) return ctx.throwError(ast, "Assertion failed");
        return;
    }

    const fnc = ctx.functions[ast.name];

    if (!fnc) return ctx.throwError(ast, "Function not defined");

    const paramValues = [];
    for (let i=0; i< ast.params.length; i++) {
        const v = exec(ctx, ast.params[i]);
        if (ctx.error) return;

        paramValues.push(v);
    }

    if (ast.params.length != paramValues.length) ctx.throwError(ast, "Invalid Number of parameters");

    const oldFileName = ctx.fileName;
    const oldFilePath = ctx.filePath;
    const oldRefs = ctx.refs;

    ctx.fileName = fnc.fileName;
    ctx.filePath = fnc.filePath;
    ctx.refs = [];

    const scope = {};
    for (let i=0; i< fnc.params.length; i++) {
        const entry = clone(paramValues[i]);
        entry.refId = i;
        scope[fnc.params[i]] = i;
        ctx.refs.push(entry);
    }

    createRefs(ctx, fnc.block, scope);

    execBlock(ctx, fnc.block);

    const res = ctx.returnValue;
    ctx.returnValue = null;

    ctx.fileName = oldFileName;
    ctx.filePath = oldFilePath;
    ctx.refs = oldRefs;

    return res;
}

function execReturn(ctx, ast) {
    ctx.returnValue = exec(ctx, ast.value);
    return;
}


function execVariable(ctx, ast) {

    const v = ctx.refs[ast.refId];
    if (!v) {
        return ctx.throwError(ast, "Variable not defined: "+ast.name);
    }

    const sels = [];
    for (let i=0; i< ast.selectors.length; i++) {
        const sel = exec(ctx, ast.selectors[i]);
        if (ctx.error) return;
        if (sel.s[0] != 1) return ctx.throwError(ast, "Variable selector cannot be an array");
        if (sel.v[0].t != "N") return NQVAL;
        sels.push(Scalar.toNumber(sel.v[0].v));
    }

    let o = 0;
    let s = v.s[0];

    if (sels.length > v.s.length-2) return ctx.throwError(ast, "Too many selectors");
    for (let i=0; i<sels.length; i++) {
        if (sels[i] >= v.s[i] / v.s[i+1]) return ctx.throwError(ast, "Out of Range");
        if (sels[i] < 0 ) return ctx.throwError(ast, "selector negative");
        o += sels[i] * v.s[i+1];
        s = v.s[i+1];
    }

    if (v.t == "V") {
        return {
            t: "V",
            s: v.s.slice(sels.length),
            v: v.v.slice(o, o+s)
        };
    } else if (v.t == "S") {
        return {
            t: "S",
            s: v.s.slice(sels.length),
            sIdx: o + v.sIdx
        };
    } else if (v.t == "C") {
        return {
            t: "C",
            s: v.s.slice(sels.length),
            cIdx: o
        };
    } else {
        assert(false);
    }
}




function execPin(ctx, ast) {
    const selsC = [];
    for (let i=0; i< ast.component.selectors.length; i++) {
        const sel = exec(ctx, ast.component.selectors[i]);
        if (ctx.error) return;

        if (sel.s[0] != 1) return ctx.throwError(ast, "Component selector cannot be an array");
        if (sel.v[0].t != "N") return NQVAL;
        selsC.push(Scalar.toNumber(sel.v[0].v));
    }

    const cIdx = ctx.getComponentIdx(ast.component.name, selsC);
    if (cIdx<0) return ctx.throwError(ast.component, "Component does not exists: "+ast.component.name);

    const selsP = [];
    for (let i=0; i< ast.pin.selectors.length; i++) {
        const sel = exec(ctx, ast.pin.selectors[i]);
        if (ctx.error) return;
        if (sel.s[0] != 1) return ctx.throwError(ast, "Signal selector cannot be an array");
        if (sel.v[0].t != "N") return NQVAL;
        selsP.push(Scalar.toNumber(sel.v[0].v));
    }
    if (!ctx.components[cIdx]) {
        return ctx.throwError(ast, "Component not defined yet");
    }
    const sIdx = ctx.components[cIdx].names.getSignalIdx(ast.pin.name, selsP);

    if (sIdx<0) return ctx.throwError(ast, "Signal not defined:" + buildFullName() );
    return {
        t: "S",
        sIdx: sIdx,
        s: utils.accSizes(ctx.components[cIdx].names.o[ast.pin.name].sizes).slice(selsP.length)
    };

    function buildFullName() {
        return ast.component.name + sels2str(selsC) + "." + ast.pin.name + sels2str(selsP);
    }

    function sels2str(sels) {
        let S = "";
        for (let i=0; i< sels.length; i++) {
            S += "[" + sels[i] + "]";
        }
        return S;
    }
}

function execLoop(ctx, ast) {

    if (ast.init) {
        exec(ctx, ast.init);
        if (ctx.error) return;
    }

    let v = exec(ctx, ast.condition);
    if (ctx.error) return;
    if (v.s[0] != 1) return ctx.throwError(ast.condition, "Condition in loop cannot be an array");
    if (v.v[0].t != "N") {
        iterateAST(ast, (ast) => {
            if (ast.type == "OP") {
                if (["==>", "<==", "==="].indexOf(ast.op) >= 0) {
                    return ctx.throwError(ast.condition, "Constraint inside a calculating block");
                }
            }
        });

        // Assert no constraints
        return;
    }

    let loopIdx = 0;
    let isTopLevelLoop = !ctx.hasParentLoop;
    ctx.hasParentLoop = true;
    while ((! ctx.F.isZero(v.v[0].v))&&(!ctx.returnValue)) {
        if (ctx.verbose && ctx.main && isTopLevelLoop) {
            let logStr =  `main loop: loopIdx ${loopIdx}`;
            if (ast.condition.type === 'OP') {
                logStr += ` condition ${ast.condition.values.map(item => item.name).join(ast.condition.op)}`;
            }
            logStr += ` at ${ctx.fileName}:${ast.first_line}`;
            console.log(logStr)
        }
        exec(ctx, ast.body);
        if (ctx.error) return;

        if (ast.step) {
            exec(ctx, ast.step);
            if (ctx.error) return;
        }

        v = exec(ctx, ast.condition);
        if (ctx.error) return;
        if (v.s[0] != 1) return ctx.throwError(ast.condition, "Condition in loop cannot be an array");
        if (v.v[0].t != "N") return ctx.throwError(ast.condition, "Condition result not a number");
        loopIdx++;
    }
    if (isTopLevelLoop) {
        ctx.hasParentLoop = null;
    }
}

function execCompute(ctx, ast) {
    iterateAST(ast, (ast) => {
        if (ast.type == "OP") {
            if (["==>", "<==", "==="].indexOf(ast.op) >= 0) {
                return ctx.throwError(ast.condition, "Constraint inside a calculating block");
            }
        }
    });
}

function execIf(ctx, ast) {
    let v = exec(ctx, ast.condition);
    if (ctx.error) return;
    if (v.s[0] != 1) return ctx.throwError(ast.condition, "Condition cannot be an array");
    if (v.v[0].t != "N") {
        iterateAST(ast, (ast) => {
            if (ast.type == "OP") {
                if (["==>", "<==", "==="].indexOf(ast.op) >= 0) {
                    return ctx.throwError(ast.condition, "Constraint inside a calculating block");
                }
            }
        });

        // Assert no constraints
        return;
    }

    if (!ctx.F.isZero(v.v[0].v)) {
        exec(ctx, ast.then);
    } else {
        if (ast.else) {
            exec(ctx, ast.else);
        }
    }
}


function execTerCon(ctx, ast) {
    let v = exec(ctx, ast.values[0]);
    if (ctx.error) return;
    if (v.s[0] != 1) return ctx.throwError(ast.condition, "Condition cannot be an array");
    if (v.v[0].t != "N") {
        iterateAST(ast, (ast) => {
            if (ast.type == "OP") {
                if (["==>", "<==", "==="].indexOf(ast.op) >= 0) {
                    return ctx.throwError(ast.condition, "Constraint inside a calculating block");
                }
            }
        });

        // Assert no constraints
        return NQVAL;
    }

    if (!ctx.F.isZero(v.v[0].v)) {
        return exec(ctx, ast.values[1]);
    } else {
        return exec(ctx, ast.values[2]);
    }
}

function execOp(ctx, ast, op, nOps) {
    const operands = [];
    for (let i=0; i<nOps; i++) {
        const a = exec(ctx, ast.values[i]);
        if (ctx.error) return;
        const aV = val(ctx, a, ast.values[i]);
        operands.push(aV);
    }

    return  {
        t: "V",
        s: [1,0],
        v: [ctx.lc[op](...operands)]
    };
}


function execOpOp(ctx, ast, op, lr) {

    if (ast.values[0].type != "VARIABLE") return ctx.throwError(ast, "incrementing a non variable");
    if (!utils.isDefined(ast.values[0].refId)) return ctx.throwError(ast, "Assigning to a non variable");
    const left = ctx.refs[ast.values[0].refId];
    if (left.t != "V") return ctx.throwError(ast, `Only variables can use ${ast.op} operations`);
    let leftSels = [];
    if (ast.values[0].selectors) {
        for (let i=0; i< ast.values[0].selectors.length; i++) {
            const sel = exec(ctx, ast.values[0].selectors[i]);
            if (ctx.error) return;

            if (sel.s[0] != 1) return ctx.throwError(ast, "Selector cannot be an array");
            if (sel.v[0].t != "N") return {t: "NQ"};

            leftSels.push( Scalar.toNumber(sel.v[0].v) );
        }
    }
    if (!left.s) return ctx.throwError(ast, "variable. not defined yet");

    let o = 0;
    let s = left.s[0];
    for (let i=0; i<leftSels.length; i++) {
        o += leftSels[i]*left.s[i+1];
        s = left.s[i+1];
    }
    if (s != 1) return ctx.throwError(ast, `invalid operator ${ast.op} in an array`);
    const resBefore = left.v[o];

    let right;
    if (ast.values[1]) {
        const rightRef = exec(ctx, ast.values[1]);
        if (ctx.error) return;
        right = val(ctx, rightRef);
    } else {
        right = {t:"N", v: ctx.F.one};
    }

    if (!right) return ctx.throwError(ast, "right operand is not initialized");
    if (!resBefore) return ctx.throwError(ast, "left operand is not initialized");

    const resAfter = ctx.lc[op](resBefore, right);
    left.v[o] = resAfter;

    if (lr == "RIGHT") {
        return {
            t: "V",
            s: [1,0],
            v: [resBefore]
        };
    } else {
        return {
            t: "V",
            s: [1,0],
            v: [resAfter]
        };
    }
}

// Extract the value of a reference.
// Must be a single value. (cannot be an array)
// The result is an LCAlgebra compatible object {t: ["N"|"LC"|"QEX"|"NQ"], [coefs|v|a,b,c]}
function val(ctx, a, ast) {
    if (a.s[0] != 1) return ctx.throwError(ast, "Array not allowed");
    if (a.t=="V") {
        return a.v[0];
    } else if (a.t=="S") {
        const res = {
            t: "LC",
            coefs: {}
        };
        let sIdx = a.sIdx;
        while (ctx.signals[sIdx].e >= 0) sIdx = ctx.signals[sIdx].e;
        res.coefs[sIdx] = ctx.F.one;
        return res;
    } else {
        ctx.throwError(ast, "Invalid type: " + a.t);
    }
}

function execConstrain(ctx, ast) {
    ast.fileName = ctx.fileName;
    ast.filePath = ctx.filePath;
    const a = exec(ctx, ast.values[0]);
    if (ctx.error) return;
    const aV = val(ctx, a, ast.values[0]);
    const b = exec(ctx, ast.values[1]);
    if (ctx.error) return;
    const bV = val(ctx, b, ast.values[1]);

    const res = ctx.lc.sub(aV,bV);
    if (res.type == "NQ") return ctx.throwError(ast, "Non Quadratic constraint");

    if (!ctx.lc.isZero(res)) {
        ctx.constraints.push(ctx.lc.toQEX(res));
        if (ctx.verbose) {
            if ((ctx.constraints.length % 10000 == 0)&&(ctx.constraints.length>0)) console.log("Constraints: " + ctx.constraints.length);
        }
    }

    return a;
}

function execInclude(ctx, ast) {
    if (ast.block) {

        const oldFilePath = ctx.filePath;
        const oldFileName = ctx.fileName;

        ctx.filePath = ast.filePath;
        ctx.fileName = ast.fileName;

        exec(ctx, ast.block);  // Process only one.

        ctx.filePath = oldFilePath;
        ctx.fileName = oldFileName;
    }
}

function execArray(ctx, ast) {
    const res = {t: "V", v:[]};


    let subSize = null;

    for (let i=0; i<ast.values.length; i++) {
        const e = exec(ctx, ast.values[i]);
        if (i==0) {
            subSize=e.s;
        } else {
            if (!utils.sameSizes(subSize, e.s)) return ctx.throwError(ast, "Array mus be homogeneous");
        }
        if (e.t == "V") {
            for (let j=0; j<e.v.length;j++) res.v.push(e.v[j]);
        } else if (e.t == "S") {
            for (let j=0; j<e.v.length;j++) {
                const sv = {t: "LC", coefs: {}};
                sv.coefs[e.sIdx+j] = ctx.F.one;
                res.v.push(sv);
            }
        } else {
            return ctx.throwError(ast, "Type not allowed in array");
        }
    }

    res.s = [ast.values.length*subSize[0], ...subSize];

    return res;
}

function createRefs(ctx, ast, scope) {
    const scopeLabels = [];
    const scopes = scope ? [scope] : [{}];
    iterateAST(ast, (ast, level) => {
        while ((scopeLabels.length>0)&&(!level.startsWith(scopeLabels[scopeLabels.length-1]))) {
            scopes.pop();
            scopeLabels.pop();
        }
        if (ast.type == "DECLARE") {
            if (ast.declareType == "COMPONENT") {
                ast.refId = define(ast.name.name, {t: "C"});
            } else if ((ast.declareType == "SIGNALIN")||
                       (ast.declareType == "SIGNALOUT")||
                       (ast.declareType == "SIGNAL")) {
                ast.refId = define(ast.name.name, {t: "S"});
            } else if (ast.declareType == "VARIABLE") {
                ast.refId = define(ast.name.name, {t: "V", s: null});
            } else {
                return ctx.throwError(ast, "Invalid declaration: " + ast.declareType);
            }
        } else if (["BLOCK", "FOR", "IF", "WHILE", "COMPUTE"].indexOf(ast.type) >= 0) {
            scopeLabels.push(level);
            scopes.push({});
        } else if (ast.type == "TEMPLATEDEF") {
            ast.refId = define(ast.name, {t: "T"});
        } else if (ast.type == "FUNCTIONDEF") {
            ast.refId = define(ast.name, {t: "F"});
        } else if (ast.type == "INCLUDE") {
            const incFileName = path.resolve(ctx.filePath, ast.file);
            const incFilePath = path.dirname(incFileName);

            ctx.includedFiles = ctx.includedFiles || [];
            if (ctx.includedFiles[incFileName]) {
                ctx.bloc = null; // Include already included...
                return;
            }

            const src = fs.readFileSync(incFileName, "utf8");

            if (!src) return ctx.throwError(ast, "Include file not found: "+incFileName);

            ctx.includedFiles[incFileName] = src.split("\n");

            ast.block = parser.parse(src);
            ast.filePath = incFilePath;
            ast.fileName = incFileName;

            const oldFilePath = ctx.filePath;
            const oldFileName = ctx.fileName;
            ctx.filePath = incFilePath;
            ctx.fileName = incFileName;

            scopes.push({});
            createRefs(ctx, ast.block);
            scopes.pop();

            ctx.filePath = oldFilePath;
            ctx.fileName = oldFileName;
        } else if (ast.type == "VARIABLE") {
            ast.refId = name2ref(ast.name);
        }

        function define(name, entry) {
            if (scopes[scopes.length-1][name]) return ctx.throwError(ast, `Name already defined: ${name}`);
            for (let i=scopes.length-2; i>=0; i--) {
                if (scopes[i][name]) ctx.logWarning(ast, `Shadowing variable: ${name}`);
            }
            const refId = ctx.refs.length;
            entry.refId = refId;
            ctx.refs.push(entry);
            scopes[scopes.length-1][name] = refId;
            return refId;
        }

        function name2ref(n) {
            for (let i=scopes.length-1; i>=0; i--) {
                if (typeof scopes[i][n] !== "undefined") return scopes[i][n];
            }
            return -1;
        }


    });

}


