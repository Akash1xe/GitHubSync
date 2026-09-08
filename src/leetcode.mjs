const ENDPOINT = "https://leetcode.com/graphql/";

const PROGRESS_QUERY = `
query userProgressQuestionList($filters: UserProgressQuestionListInput) {
  userProgressQuestionList(filters: $filters) {
    totalNum
    questions {
      frontendId
      title
      titleSlug
      difficulty
      lastSubmittedAt
      topicTags { name slug }
    }
  }
}`;

const QUESTION_LIST_QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      frontendQuestionId: questionFrontendId
      difficulty
      status
      title
      titleSlug
      topicTags { name slug }
    }
  }
}`;

const SUBMISSION_LIST_QUERY = `
query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!, $status: Int) {
  questionSubmissionList(
    offset: $offset
    limit: $limit
    lastKey: $lastKey
    questionSlug: $questionSlug
    status: $status
  ) {
    lastKey
    hasNext
    submissions {
      id
      statusDisplay
      lang
      langName
      timestamp
    }
  }
}`;

const SUBMISSION_DETAILS_QUERY = `
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code
    timestamp
    lang { name verboseName }
    topicTags { slug name }
    question { questionId titleSlug }
  }
}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asErrorMessage(errors) {
  if (!Array.isArray(errors)) return String(errors || "Unknown GraphQL error");
  return errors.map((item) => item?.message || JSON.stringify(item)).join("; ");
}

export class LeetCodeClient {
  constructor({ session, csrf = "", delayMs = 400 }) {
    this.session = session;
    this.csrf = csrf;
    this.delayMs = delayMs;
  }

  async request(query, variables, operationName, attempt = 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const cookieParts = [`LEETCODE_SESSION=${this.session}`];
    if (this.csrf) cookieParts.push(`csrftoken=${this.csrf}`);

    const headers = {
      "content-type": "application/json",
      "accept": "application/json",
      "cookie": cookieParts.join("; "),
      "origin": "https://leetcode.com",
      "referer": "https://leetcode.com/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
    };
    if (this.csrf) headers["x-csrftoken"] = this.csrf;

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables, operationName }),
        signal: controller.signal
      });

      if (response.status === 403) {
        throw new Error("LeetCode rejected the session (HTTP 403). Refresh LEETCODE_SESSION from your browser and try again.");
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt <= 5) {
          await sleep(Math.min(30000, 1500 * 2 ** (attempt - 1)));
          return this.request(query, variables, operationName, attempt + 1);
        }
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`LeetCode HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const payload = await response.json();
      if (payload.errors?.length) {
        throw new Error(`LeetCode GraphQL error: ${asErrorMessage(payload.errors)}`);
      }
      return payload.data;
    } catch (error) {
      if (error?.name === "AbortError") {
        if (attempt <= 3) {
          await sleep(1000 * attempt);
          return this.request(query, variables, operationName, attempt + 1);
        }
        throw new Error("LeetCode request timed out repeatedly.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async listSolvedQuestions() {
    try {
      const fromProgress = await this.listSolvedFromProgress();
      if (fromProgress.length) return fromProgress;
    } catch (error) {
      console.warn(`Progress endpoint unavailable: ${error.message}`);
      console.warn("Falling back to the authenticated solved-problem list...");
    }

    return this.listSolvedFromQuestionList();
  }

  async listSolvedFromProgress() {
    const pageSize = 500;
    let skip = 0;
    let total = Infinity;
    const questions = [];

    while (skip < total) {
      const data = await this.request(
        PROGRESS_QUERY,
        { filters: { questionStatus: "SOLVED", skip, limit: pageSize } },
        "userProgressQuestionList"
      );

      const page = data?.userProgressQuestionList;
      if (!page) throw new Error("Missing userProgressQuestionList response.");

      const batch = page.questions || [];
      questions.push(...batch.map((q) => ({
        frontendId: q.frontendId,
        title: q.title,
        titleSlug: q.titleSlug,
        difficulty: q.difficulty,
        lastSubmittedAt: q.lastSubmittedAt,
        topicTags: q.topicTags || []
      })));

      total = Number(page.totalNum ?? questions.length);
      if (!batch.length) break;
      skip += batch.length;
    }

    return dedupeBySlug(questions);
  }

  async listSolvedFromQuestionList() {
    const pageSize = 100;
    let skip = 0;
    let total = Infinity;
    const questions = [];

    while (skip < total) {
      const data = await this.request(
        QUESTION_LIST_QUERY,
        { categorySlug: "", skip, limit: pageSize, filters: { status: "AC" } },
        "problemsetQuestionList"
      );

      const page = data?.problemsetQuestionList;
      if (!page) throw new Error("Missing problemsetQuestionList response.");

      const rawBatch = page.questions || [];
      const batch = rawBatch.filter((q) => String(q.status || "").toLowerCase() === "ac");
      if (rawBatch.length && !batch.length) {
        throw new Error("Authenticated solved-problem fallback returned no accepted statuses. Refresh your LeetCode session cookie.");
      }
      questions.push(...batch.map((q) => ({
        frontendId: q.frontendQuestionId,
        title: q.title,
        titleSlug: q.titleSlug,
        difficulty: q.difficulty,
        lastSubmittedAt: null,
        topicTags: q.topicTags || []
      })));

      total = Number(page.total ?? questions.length);
      if (!rawBatch.length) break;
      skip += rawBatch.length;
    }

    return dedupeBySlug(questions);
  }

  async latestAcceptedSubmission(questionSlug, preferredLanguage = "cpp") {
    await sleep(this.delayMs);
    const data = await this.request(
      SUBMISSION_LIST_QUERY,
      {
        questionSlug,
        offset: 0,
        limit: 25,
        lastKey: null,
        status: 10
      },
      "submissionList"
    );

    const submissions = data?.questionSubmissionList?.submissions || [];
    if (!submissions.length) return null;

    const preferred = submissions.find((submission) => languageMatches(submission.lang, preferredLanguage));
    return preferred || submissions[0];
  }

  async submissionDetails(submissionId) {
    await sleep(this.delayMs);
    const data = await this.request(
      SUBMISSION_DETAILS_QUERY,
      { submissionId: Number(submissionId) },
      "submissionDetails"
    );
    return data?.submissionDetails || null;
  }
}

function dedupeBySlug(questions) {
  const map = new Map();
  for (const question of questions) {
    if (question?.titleSlug) map.set(question.titleSlug, question);
  }
  return [...map.values()];
}

function languageMatches(actual = "", preferred = "") {
  const a = actual.toLowerCase().replaceAll(" ", "");
  const p = preferred.toLowerCase().replaceAll(" ", "");
  if (p === "cpp" || p === "c++") return ["cpp", "c++", "cpp17", "cpp20", "cpp23"].includes(a);
  return a === p;
}
