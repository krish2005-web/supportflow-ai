
import json
import sys
from pathlib import Path

from app.ai.ai_service import answer_ticket_question



ROOT = Path(__file__).resolve().parents[1]
GOLDEN_FILE = ROOT / "eval" / "golden_questions.json"



TICKET = {
    "ticket_id": 42,
    "title": "Password reset link not working",
    "description": "Reset link is not working",
    "status": "open",
    "priority": "medium",
}


def main():

    
    cases = json.loads(
        GOLDEN_FILE.read_text(encoding="utf-8")
    )

    passed = 0

    
    for case in cases:

        question = case["question"]

        
        result = answer_ticket_question(
            TICKET,
            question,
            history=[]
        )

        answer = (result.get("answer") or "").strip()
        answer_lower = answer.lower()

        
        expected_words = case.get("expects", [])

        expected_found = any(
            word.lower() in answer_lower
            for word in expected_words
        )

        
        forbidden_words = case.get("forbids", [])

        forbidden_found = any(
            word.lower() in answer_lower
            for word in forbidden_words
        )

        
        if answer and expected_found and not forbidden_found:
            print(f"[PASS] {case['id']}")
            passed += 1
        else:
            print(f"[FAIL] {case['id']}")

    
    total = len(cases)

    if total == 0:
        print("No test questions found.")
        return 1

    score = (passed / total) * 100

    print(f"\nScore: {passed}/{total} ({score:.0f}%)")

    
    if score >= 80:
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
