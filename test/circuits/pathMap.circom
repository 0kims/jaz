include "@customlib/pathMapDep.circom";

template Foo() {
    signal input in;
    component bar = Bar();

    bar.in <== in;
}

component main = Foo();
