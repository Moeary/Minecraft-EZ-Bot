/**
 * Skill registry entry. Each skill owns its command declarations and future OpenAI tool schema.
 */
const skills = [
  require('./combat'),
  require('./fishing'),
  require('./pathfinder'),
  require('./chat-command'),
  require('./mining'),
  require('./supply'),
  require('./survival'),
  require('./openai-tools')
];

function listSkills() {
  return skills.map(({ handler, ...metadata }) => metadata);
}

function getSkill(id) {
  return skills.find((skill) => skill.id === id) || null;
}

module.exports = { skills, listSkills, getSkill };
