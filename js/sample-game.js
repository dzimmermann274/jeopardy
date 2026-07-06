"use strict";
/* Built-in sample game so the app can be tried without a Google Sheet. */
const SAMPLE_GAME = {
  title: "Sample Game",
  rounds: [{
    name: "Jeopardy!",
    categories: [
      { name: "State of Confusion", clues: [
        { value: 200,  clue: "This state is home to the Grand Canyon.", answer: "Arizona" },
        { value: 400,  clue: "Nashville, its capital, is nicknamed \"Music City\".", answer: "Tennessee" },
        { value: 600,  clue: "This is the only U.S. state that borders just one other state.", answer: "Maine" },
        { value: 800,  clue: "Its state flag is the only U.S. state flag that isn't rectangular.", answer: "Ohio" },
        { value: 1000, clue: "This state's official nickname is \"The Equality State\".", answer: "Wyoming" },
      ]},
      { name: "Animal Kingdom", clues: [
        { value: 200,  clue: "This black-and-white bear native to China mostly eats bamboo.", answer: "The giant panda" },
        { value: 400,  clue: "A group of lions is called this.", answer: "A pride" },
        { value: 600,  clue: "This is the only mammal capable of true sustained flight.", answer: "The bat" },
        { value: 800,  clue: "The heart of this tallest land animal can weigh 25 pounds.", answer: "The giraffe", dd: true },
        { value: 1000, clue: "This cephalopod has three hearts and blue blood.", answer: "The octopus" },
      ]},
      { name: "Food, Glorious Food", clues: [
        { value: 200,  clue: "This Italian dish's name means \"pie\" and is often topped with pepperoni.", answer: "Pizza" },
        { value: 400,  clue: "Guacamole is made primarily from this fruit.", answer: "The avocado" },
        { value: 600,  clue: "This Japanese dish of vinegared rice is often paired with raw fish.", answer: "Sushi" },
        { value: 800,  clue: "Sauerkraut is made by fermenting this vegetable.", answer: "Cabbage" },
        { value: 1000, clue: "This spice, the world's most expensive by weight, comes from crocus flowers.", answer: "Saffron" },
      ]},
      { name: "Movie Magic", clues: [
        { value: 200,  clue: "\"May the Force be with you\" comes from this film franchise.", answer: "Star Wars" },
        { value: 400,  clue: "This 1997 film about a doomed ocean liner won 11 Oscars.", answer: "Titanic" },
        { value: 600,  clue: "Buzz Lightyear and Woody star in this 1995 animated film.", answer: "Toy Story" },
        { value: 800,  clue: "This director made Jaws, E.T., and Jurassic Park.", answer: "Steven Spielberg" },
        { value: 1000, clue: "This 1994 film's title character says life is like a box of chocolates.", answer: "Forrest Gump" },
      ]},
      { name: "Sports Shorts", clues: [
        { value: 200,  clue: "A perfect game in this sport scores 300.", answer: "Bowling" },
        { value: 400,  clue: "This tennis tournament is played on grass in London.", answer: "Wimbledon" },
        { value: 600,  clue: "In golf, this term means two strokes under par on a hole.", answer: "An eagle" },
        { value: 800,  clue: "This country has won the most FIFA World Cups.", answer: "Brazil" },
        { value: 1000, clue: "The Iditarod is a long-distance race using these animals.", answer: "Sled dogs" },
      ]},
      { name: "Word Play", clues: [
        { value: 200,  clue: "This 3-letter word can precede \"hive\", \"line\", and \"keeper\".", answer: "Bee" },
        { value: 400,  clue: "A word that reads the same forward and backward, like \"kayak\".", answer: "A palindrome" },
        { value: 600,  clue: "\"Bookkeeper\" is unusual for having three consecutive sets of these.", answer: "Double letters" },
        { value: 800,  clue: "This is the only common English word ending in \"-mt\".", answer: "Dreamt" },
        { value: 1000, clue: "The word \"alphabet\" comes from the first two letters of this alphabet.", answer: "The Greek alphabet (alpha and beta)" },
      ]},
    ],
  }],
  final: {
    category: "World Geography",
    clue: "This is the only country in the world that borders both the Atlantic and Indian Oceans on the African continent's southern tip.",
    answer: "South Africa",
  },
};
