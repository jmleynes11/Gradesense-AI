function studentName(item) {
  return String(item?.student?.name || item?.student || item?.name || "").trim();
}

function sortStudents(items = []) {
  return [...items].sort((left, right) => {
    const byName = studentName(left).localeCompare(studentName(right), undefined, { sensitivity: "base" });
    if (byName) return byName;
    return String(left?._id || left?.student?._id || "").localeCompare(String(right?._id || right?.student?._id || ""));
  });
}

module.exports = { sortStudents };
