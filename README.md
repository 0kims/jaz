# Circom

Circom is a language designed to write arithmetic circuits that can be used in zero-knowledge proofs.

In particular, it is designed to work in [zksnarks JavaScript library](https://github.com/iden3/zksnark).

## Usage

### Circom Docs

You can read the details of circom in [the documentation webpage](https://docs.circom.io/).

### Tutorial

A good starting point [is this tutorial](https://github.com/iden3/circom/blob/master/TUTORIAL.md)

Also this [video](https://www.youtube.com/watch?v=-9TJa1hVsKA) is a good starting point.

### First circuit

Creation of a circuit. This is an example of a NAND door:

```
template NAND() {
    signal private input a;
    signal input b;
    signal output out;

    out <== 1 - a*b;
    a*(a-1) === 0;
    b*(b-1) === 0;
}

component main = NAND();
```

The language uses mainly JavaScript/C syntax together with 5 extra operators to define the following constraints:

`<==` , `==>`  : These two operators are used to connect signals and at the same time imply a constraint.

As it is shown in the above example, a value is assigned to `out` and a constraint is also generated.  The assigned value must be of the form a*b+c where a,b and c are linear combinations of the signals.

`<--` , `-->` : These operators assign values to signals but do not generate any constraints. This allows to assign to a signal any value involving strange operations like shifts, divisions, modulo operations, etc.  In general, these operators are used together with a `===` operator in order to force the constraint.

`===` : This operator defines a constraint. The constraint must be simplificable to a constraint of the form `a*b+c=0`, where `a`, `b` and `c` are linear combinations of the signals.

In the above example, both inputs are forced to be binary by adding the constraints `a*(a-1)===0` and `b*(b-1) === 0`.

### Compilation the circuit

First of all, the compiler must be installed by typing:

```
npm install -g circom
````

The circuit is compiled with the following command:

```
circom mycircuit.circom -o mycircuit.json
```

The resulting output ( `mycircuit.json` ) can be used in the [zksnarks JavaScript library](https://github.com/iden3/zksnark).

In this library one can do the trusted setup, create the proofs and verify them.

### Number to binary

In many situations, one has to convert an input to its binary representation. Therefore, the circuits can be written this way:

```
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1=0;

    for (var i = 0; i<n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] -1 ) === 0;
        lc1 += out[i] * 2**i;
    }

    lc1 === in;
}

component main = Num2Bits(8);
```

First of all, note that templates can have parameters. This allows to create libraries with templates that generate circuits in parametric ways. In this case, the circuit has an output of 8 signals, but one can easily instantiate any circuit with any number of outputs.

The inputs and outputs are defined as arrays. The programm allows multidimensional arrays for signals and variables.

Then, the values are assigned to each of the signals. In this case, the values are assigned without the constraint using the shift and & operators:
`out[i] <-- (in >> i) & 1;`

Afterwards, the constraints need to be defined. In this case, there is a big constraint of the form:

```
in === out[0]*2**0  + out[1]*2**1 + out[2]*2**2  + ... + out[n-1]*2**(n-1)
```

We do this by using a variable `lc1` and adding each signal multiplied by its coefficient.
This variable does not hold a value at compilation time, but it holds a linear combination and it is used in the last constraint:

```
lc1 === in;
```

The last step is to force each output to be binary. This is done by adding the following constraint to each output:

```
out[i] * (out[i] -1 ) === 0;
```

### A binary adder

Let's now create a 32bits adder.

This operation could be done directly by adding a simple constraint `out === in1 + in2`,
but doing this the operation would not be module `2**32` but `r`, where `r`is the range of the elliptic curve. In the case of the zCash current implementation of zkSNARKs this number is typically some prime close to 2**253.

So, the strategy we will follow will be to first convert a number to binary, then do the addition using the binary representation like in regular electronic circuits, and finally change it back to a number.

To do this, we create 3 files: `bitify.circom`, `binsum.circom` and `sum_test.circom`.

bitify.circom:
```
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1=0;

    for (var i = 0; i<n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] -1 ) === 0;
        lc1 += out[i] * 2**i;
    }

    lc1 === in;

}

template Bits2Num(n) {
    signal input in[n];
    signal output out;
    var lc1=0;

    for (var i = 0; i<n; i++) {
        lc1 += in[i] * 2**i;
    }

    lc1 ==> out;
}

```

binsum.circom
```
/*

Binary sum
==========

This component creates a binary sum componet of ops operands and n bits each operand.

e is number of carries and it depends on the number of operands in the input.

Main Constraint:
   in[0][0]     * 2^0  +  in[0][1]     * 2^1  + ..... + in[0][n-1]    * 2^(n-1)  +
 + in[1][0]     * 2^0  +  in[1][1]     * 2^1  + ..... + in[1][n-1]    * 2^(n-1)  +
 + ..
 + in[ops-1][0] * 2^0  +  in[ops-1][1] * 2^1  + ..... + in[ops-1][n-1] * 2^(n-1)  +
 ===
   out[0] * 2^0  + out[1] * 2^1 +   + out[n+e-1] *2(n+e-1)

To waranty binary outputs:

    out[0]     * (out[0] - 1) === 0
    out[1]     * (out[0] - 1) === 0
    .
    .
    .
    out[n+e-1] * (out[n+e-1] - 1) === 0

 */


/* This function calculates the number of extra bits in the output to do the full sum. */

function nbits(a) {
    var n = 1;
    var r = 0;
    while (n-1<a) {
        r++;
        n *= 2;
    }
    return r;
}


template BinSum(n, ops) {
    var nout = nbits((2**n -1)*ops);
    signal input in[ops][n];
    signal output out[nout];

    var lin = 0;
    var lout = 0;

    var k;
    var j;

    for (k=0; k<n; k++) {
        for (j=0; j<ops; j++) {
            lin += in[j][k] * 2**k;
        }
    }

    for (k=0; k<nout; k++) {
        out[k] <-- (lin >> k) & 1;

        // Ensure out is binary
        out[k] * (out[k] - 1) === 0;

        lout += out[k] * 2**k;
    }

    // Ensure the sum

    lin === lout;
}
```

sumtest.circom:
```
include "bitify.circom"
include "binsum.circom"

template Adder() {
    signal private input a;
    signal input b;
    signal output out;

    component n2ba = Num2Bits(32);
    component n2bb = Num2Bits(32);
    component sum = BinSum(32,2);
    component b2n = Bits2Num(32);

    n2ba.in <== a;
    n2bb.in <== b;

    for (var i=0; i<32; i++) {
        sum.in[0][i] <== n2ba.out[i];
        sum.in[1][i] <== n2bb.out[i];
        b2n.in[i] <== sum.out[i];
    }

    out <== b2n.out;
}

component main = Adder();
```

In this example we have shown how to design a top-down circuit with many subcircuits and how to connect them together. One can also see that auxiliary functions to do specific computations can be created.


### More examples.

You can find more examples in this library of basic circits [circomlib](https://github.com/iden3/circomlib)


## License

Circom is part of the iden3 project copyright 2018 0KIMS association and published with GPL-3 license. Please check the COPYING file for more details.



