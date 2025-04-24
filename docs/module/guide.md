# Module Implementation Guide

## 0. Secure the rights.

All games on RTT are published with the right holders written express permission.
It's better to secure the rights before spending a lot of time on an implementation,
in case the publisher says no.
If you have a game in mind that you want to host on RTT, approach Tor to talk
about whether a license may be available.

## 1. Create a git project.

TODO

## 2. Setup the required files.

TODO

## 3. Import and prepare the art assets.

Ask Tor to do this for you!

## 4. Board representation.

Design the data representation for the game board state.

Implement enough of the rules to create and setup the initial board game state.

Implement enough of the client to display the initial board game state.

The client doesn't need to be fancy, all we need at this point is to be able to
present the spaces and pieces at their approximate locations to be able to interact with them.
Fine tuning the look & feel comes much later.

## 5. Implement the sequence of play and core rules.

Data representation accessors and helper functions.

Main sequence of play.

## 6. Implement events and special cases.

All the hard work.

## 7. Profit!
