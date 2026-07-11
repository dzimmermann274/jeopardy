"use strict";
/* Built-in sample game so the app can be tried without a Google Sheet. */
const SAMPLE_GAME = {
  title: "Sample Game",
  subtitle: "Welcome to",
  // Demo text for the Rules screen. In a real game this comes from cell D7 of the
  // Game Setup tab — not from the code. "##" starts a new rule.
  rules: "Teams take turns picking a category and a dollar amount.##Confer with your team, then answer out loud — the host decides.##Right answer: add the money. Wrong answer: lose it.##A Daily Double lets that team wager anything up to its score.##Each team may phone grandma ONCE for a hint.##Highest score after Final Jeopardy wins.",
  // "Turn bonus" (bump): extra points the team whose turn it is earns for a correct
  // answer. In a real game this comes from cell F7 of the Game Setup tab; the host
  // can change it live on the control panel. 0 turns the feature off.
  bump: 200,
  // Teams as the sheet gives them: a number (the ID) and the players. The name is
  // blank — the players choose it during the game and the host types it in.
  teams: [
    { id: 1, name: "", players: ["Tony", "Michael Paul"] },
    { id: 2, name: "", players: ["Connor", "Joe"] },
    { id: 3, name: "", players: ["Amy", "Cara"] },
  ],
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
        { value: 200,  clue: "PICTURE CLUE: This common household pet is shown on the screen.", answer: "A cat",
          image: "https://upload.wikimedia.org/wikipedia/commons/1/15/Cat_August_2010-4.jpg" },
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
        { value: 1000, clue: "HOST'S CHOICE: This answer isn't preset — the host types it live! (Try it: type anything on the control panel and release it to the TV.)", answer: "", unknown: true },
      ]},
    ],
  }],
  final: {
    category: "World Geography",
    clue: "This is the only country in the world that borders both the Atlantic and Indian Oceans on the African continent's southern tip.",
    answer: "South Africa",
    // Demo instructions for the intro screen. In a real game this text comes
    // from cell D18 of the Game Setup tab — not from the code.
    instructions: "One final clue. One last chance.##Each team secretly wagers any amount up to its score, then has 30 seconds to write an answer.##Right answer: add your wager. Wrong answer: lose it.##Highest score wins it all.",
  },
};
