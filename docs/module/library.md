# Utility Library

The common framework.js file defines many useful functions.

Some of these are optimized versions of common Javascript functions,
that are simpler and faster because they do less.

For example array_delete is much faster than Array.splice() because all it does
is remove an item from the array. Splice also creates a new array with the deleted items
and returns it; and since we usually don't need that it's better to use the simpler function
defined here.

Likewise, array_delete_item is faster than using array.filter.

## Object functions

	function object_copy(original)
		Make a deep copy of an object without cycles.


## Array functions

	function array_delete(array, index)
		Delete the item at index.

	function array_delete_item(array, item)
		Find and delete the first instance of the item.

	function array_insert(array, index, item)
		Insert item at the index.

	function array_delete_pair(array, index)
		Delete two items at the index.

	function array_insert_pair(array, index, a, b)
		Insert two items a and b at the index.

## Set functions

Sets can be represented as a sorted array.
To use an array as a set this way, we provide these functions.

	function set_clear(set)
		Delete every entry in the set.

	function set_has(set, item)
		Check if item exists in the set.

	function set_add(set, item)
		Add an item to the set (if it doesn't alerady exist).

	function set_delete(set, item)
		Delete an item from the set (if it exists).

	function set_toggle(set, item)
		Toggle the presence of an item in the set.

## Map functions

Maps (or key/value dictionaries) can also be represented as an array of pairs
sorted on the key value.

	function map_clear(map)
		Delete every entry in the map.

	function map_has(map, key)
		Check if the map has a value associated with the key.

	function map_get(map, key, missing)
		Return the value associated with key;
		or missing if the key is not present.

	function map_set(map, key, value)
		Set the value for the key.
		
	function map_delete(map, key)
		Delete an entry.

	function map_for_each(map, fun)
		Iterate over each entry calling fun(key, value)

## Group By

The Object.groupBy function in standard Javascript is implemented here for both
Objects and our "arrays as map" representation.

	function object_group_by(items, callback)
	function map_group_by(items, callback)

## Game functions

These functions affect the game state.

	function log(s)

View functions:

	function prompt(s)
	function button(action, enabled = true)
	function action(action, argument)

State transitions:

	function call_or_goto(pred, name, env)
	function call(name, env)
	function goto(name, env)
	function end(result)

Ending a game:

	function finish(result, message)

## Undo stack handling

	function clear_undo()
	function push_undo()
	function pop_undo()

## Random number generator

	function random(range)
	function shuffle(list)

