const TOPIC_RULES = [
  ["Binary-Search", ["Binary Search"]],
  ["Sliding-Window", ["Sliding Window"]],
  ["Two-Pointers", ["Two Pointers"]],
  ["Dynamic-Programming", ["Dynamic Programming"]],
  ["Graphs", [
    "Graph",
    "Depth-First Search",
    "Breadth-First Search",
    "Union Find",
    "Shortest Path",
    "Topological Sort",
    "Minimum Spanning Tree",
    "Strongly Connected Component"
  ]],
  ["Trees", ["Tree", "Binary Tree", "Binary Search Tree", "Trie"]],
  ["Backtracking", ["Backtracking"]],
  ["Greedy", ["Greedy"]],
  ["Heap-Priority-Queue", ["Heap (Priority Queue)"]],
  ["Monotonic-Stack", ["Monotonic Stack"]],
  ["Monotonic-Queue", ["Monotonic Queue"]],
  ["Stack", ["Stack"]],
  ["Queue", ["Queue"]],
  ["Linked-List", ["Linked List", "Doubly-Linked List"]],
  ["Intervals", ["Interval"]],
  ["Prefix-Sum", ["Prefix Sum"]],
  ["Hashing", ["Hash Table", "Counting"]],
  ["Bit-Manipulation", ["Bit Manipulation", "Bitmask"]],
  ["String", ["String", "String Matching", "Rolling Hash", "Suffix Array"]],
  ["Math", [
    "Math",
    "Number Theory",
    "Combinatorics",
    "Geometry",
    "Probability and Statistics",
    "Randomized"
  ]],
  ["Sorting", ["Sorting", "Bucket Sort", "Counting Sort", "Radix Sort"]],
  ["Divide-and-Conquer", ["Divide and Conquer"]],
  ["Matrix", ["Matrix"]],
  ["Arrays", ["Array"]],
  ["Design", ["Design", "Data Stream", "Iterator"]],
  ["Simulation", ["Simulation"]],
  ["Database", ["Database"]],
  ["Concurrency", ["Concurrency"]],
  ["Shell", ["Shell"]]
];

export function pickPrimaryTopic(topicTags = []) {
  const names = new Set(topicTags.map((tag) => typeof tag === "string" ? tag : tag?.name).filter(Boolean));

  for (const [folder, aliases] of TOPIC_RULES) {
    if (aliases.some((name) => names.has(name))) return folder;
  }

  return "Other";
}

export function topicDisplayName(folder) {
  return folder.replaceAll("-", " ");
}
