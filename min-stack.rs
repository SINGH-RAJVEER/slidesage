// A minimal, compiling MinStack helper implementation.
// Compile: rustc min-stack.rs

fn push_min(st1: &mut Vec<i32>, st2: &mut Vec<i32>, val: i32) {
    st1.push(val);

    let should_push = match st2.last() {
        None => true,
        Some(&current_min) => val <= current_min,
    };

    if should_push {
        st2.push(val);
    }
}

fn pop_min(st1: &mut Vec<i32>, st2: &mut Vec<i32>) -> i32 {
    let val = st1.pop().expect("pop from empty stack");

    let should_pop_min = match st2.last() {
        None => false,
        Some(&current_min) => current_min == val,
    };

    if should_pop_min {
        st2.pop();
    }

    val
}

fn get_min(st2: &Vec<i32>) -> i32 {
    *st2.last().expect("min from empty stack")
}

fn main() {
    let mut st1 = Vec::<i32>::new();
    let mut st2 = Vec::<i32>::new();

    push_min(&mut st1, &mut st2, 3);
    push_min(&mut st1, &mut st2, 5);
    push_min(&mut st1, &mut st2, 2);
    push_min(&mut st1, &mut st2, 2);
    push_min(&mut st1, &mut st2, 4);

    println!("min: {}", get_min(&st2));
    pop_min(&mut st1, &mut st2);
    pop_min(&mut st1, &mut st2);
    println!("min: {}", get_min(&st2));
}
