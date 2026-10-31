const question = {
  _id: "synthetic-matter-question", type: "essay", points: 10,
  text: "Explain how solids, liquids, and gases differ in shape, volume, and particle behavior.",
  suggestedAnswer: "Solids keep their shape and volume, with closely packed particles vibrating in place. Liquids keep their volume but take their container's shape as particles slide past one another. Gases have no fixed shape or volume; widely spaced particles move freely and fill the container.",
  rubric: { criteria: [
    { criterion: "Solid: fixed shape and volume; tightly packed particles vibrate in place", maxScore: 3 },
    { criterion: "Liquid: fixed volume, container shape; close particles slide past each other", maxScore: 3 },
    { criterion: "Gas: no fixed shape or volume; separated particles move freely and fill container", maxScore: 4 },
  ] },
};
const lessonContent = question.suggestedAnswer;
const cases = [
  { name: "correct", answer: question.suggestedAnswer, expectedMin: 9, expectedMax: 10 },
  { name: "paraphrased_correct", answer: "In a solid, the particles are held close together and only jiggle around their positions, so both its size and form stay the same. In a liquid, nearby particles can move around each other: its amount of space stays the same, while its outline follows the vessel. Gas particles are far apart and travel freely, spreading throughout whatever vessel holds them, so neither their outline nor occupied space is fixed.", expectedMin: 9, expectedMax: 10 },
  { name: "partial", answer: "A solid keeps its shape and volume because its tightly packed particles vibrate in place. I do not know how liquids and gases behave.", expectedMin: 2, expectedMax: 4 },
  { name: "incorrect", answer: "Solids have no fixed shape or volume and their particles are far apart and move freely. Liquids have a fixed shape and their particles cannot move past one another. Gases keep a fixed shape and volume and their particles only vibrate in place.", expectedMin: 0, expectedMax: 1 },
  { name: "irrelevant", answer: "My favorite sport is basketball. I enjoy watching games and playing with friends on weekends.", expectedMin: 0, expectedMax: 0 },
  { name: "blank", answer: "   ", expectedMin: 0, expectedMax: 0 },
  { name: "minor_omission", answer: "Solids keep their shape and volume because tightly packed particles vibrate in place. Liquids retain their volume and take the shape of the container. Gases have neither fixed shape nor volume; their widely separated particles move freely and fill the container.", expectedMin: 8.5, expectedMax: 9.75 },
  { name: "mostly_correct_missing_details", answer: "Solids have a fixed shape and volume, with particles packed close together. Liquids have a fixed volume but take the shape of their container. Gases have no fixed shape or volume and fill their container.", expectedMin: 6, expectedMax: 8.5 },
  { name: "mixed_correct_and_incorrect", answer: "Solids keep their shape and volume because tightly packed particles vibrate in place. Liquids have a fixed shape and volume because their particles cannot move at all. Gases have no fixed shape or volume; widely spaced particles move freely to fill the container.", expectedMin: 6, expectedMax: 8.5,
    expectedCriterionRanges: [null, { min: 0.25, max: 1.5 }, null] },
  { name: "faulty_reasoning", answer: "Solids have a fixed shape and volume. Liquids keep their volume but take the container's shape. Gases have no fixed shape or volume and fill the container. This happens because liquid particles cannot move past each other, whereas gas particles are tightly locked in place, so they push the container outward.", expectedMin: 3, expectedMax: 6.5 },
  { name: "one_correct_concept", answer: "Solids have a fixed shape. Their volume expands constantly and their particles are far apart moving freely. Liquids have a fixed shape and constantly changing volume, while gases have a fixed shape and volume; neither allows any particle motion.", expectedMin: 0.5, expectedMax: 2 },
  { name: "short_correct", answer: "Solids: fixed shape/volume; close particles vibrate. Liquids: fixed volume, container's shape; close particles slide past each other. Gases: no fixed shape/volume; separated particles move freely, filling the container.", expectedMin: 9, expectedMax: 10 },
  { name: "long_with_errors", answer: "Matter is fascinating and we encounter it everywhere from kitchens to outer space. I enjoy observing ice cubes and water, and many people have done experiments in classrooms. Solids keep their shape and volume. Liquids keep their volume but take their container's shape. Gases have no fixed shape or volume and fill their container. It is important to look carefully and record observations in notebooks because science has a long history. However, solid particles are widely spaced and move freely throughout a container, liquid particles are immobile and locked together, and gas particles are tightly packed and only vibrate in place. This is why gases cannot be compressed, while solids are easy to compress like air. Famous scientists have studied nature for centuries, and these ideas affect technology, cooking, sports, and daily life.", expectedMin: 3, expectedMax: 7 },
];
module.exports = { question, lessonContent, cases };
