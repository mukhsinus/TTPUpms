/**
 * Documents the student list visibility rule (active semester + nullable-draft drafts).
 */
import test from "node:test";
import assert from "node:assert/strict";

function studentSeesSubmissionInList(row, activeSemester) {
  return row.semester === activeSemester || (row.status === "draft" && row.semester == null);
}

test("submitted row from another semester is hidden", () => {
  assert.equal(
    studentSeesSubmissionInList({ status: "submitted", semester: "first" }, "second"),
    false,
  );
});

test("draft with null semester stays visible after semester switch", () => {
  assert.equal(studentSeesSubmissionInList({ status: "draft", semester: null }, "second"), true);
});

test("submitted row in active semester is visible", () => {
  assert.equal(
    studentSeesSubmissionInList({ status: "submitted", semester: "second" }, "second"),
    true,
  );
});
