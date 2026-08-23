// 팬 대문 제목 정리 규칙 테스트(cleanSheetTitle).
// 핵심 보장: ① 빈 값/비문자열 = "" (기본 제목으로 폴백)  ② 이모지가 깨지지 않는다(코드포인트 단위 절단)
//           ③ 줄바꿈·탭은 공백으로 접힌다  ④ 상한 24 코드포인트
import { cleanSheetTitle, SHEET_TITLE_MAX } from "../lib/upboCore";

let passed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

// ① 빈 값·비문자열
assertEq(cleanSheetTitle(""), "", "빈 문자열 → 빈 값");
assertEq(cleanSheetTitle("   "), "", "공백만 → 빈 값");
assertEq(cleanSheetTitle(undefined), "", "undefined → 빈 값");
assertEq(cleanSheetTitle(null), "", "null → 빈 값");
assertEq(cleanSheetTitle(123), "", "숫자 → 빈 값");

// ② 이모지 보존 + 코드포인트 절단(서로게이트 쌍 반토막 금지)
assertEq(cleanSheetTitle("🐻 늉이네 업보창고"), "🐻 늉이네 업보창고", "이모지 포함 그대로");
assertEq(cleanSheetTitle("늉이 업보시트 ✨"), "늉이 업보시트 ✨", "끝 이모지 보존");
const manyEmoji = "😀".repeat(30); // 30 코드포인트 = 60 UTF-16 단위
const cut = cleanSheetTitle(manyEmoji);
assertEq(Array.from(cut).length, SHEET_TITLE_MAX, "이모지 30개 → 24개로 절단");
assertEq(cut, "😀".repeat(SHEET_TITLE_MAX), "절단 후 이모지 전부 온전(깨진 문자 없음)");
assertEq(/[\uD800-\uDFFF]$/.test(cut) && !/[\uDC00-\uDFFF]$/.test(cut), false, "끝에 외톨이 서로게이트 없음");

// ③ 줄바꿈·탭·전각공백 → 공백 한 칸, 앞뒤 trim
assertEq(cleanSheetTitle("늉이\n업보시트"), "늉이 업보시트", "줄바꿈 → 공백");
assertEq(cleanSheetTitle("늉이\t\t업보시트"), "늉이 업보시트", "탭 → 공백");
assertEq(cleanSheetTitle("늉이　업보시트"), "늉이 업보시트", "전각 공백 → 공백");
assertEq(cleanSheetTitle("  늉이   업보시트  "), "늉이 업보시트", "연속 공백 접기+trim");

// ④ 상한 24 코드포인트(한글·영문 혼합), 절단 후 끝 공백 제거
assertEq(cleanSheetTitle("가".repeat(40)), "가".repeat(24), "한글 40자 → 24자");
assertEq(cleanSheetTitle("a".repeat(24) + " b"), "a".repeat(24), "24자 뒤 공백+문자 → 24자(끝 공백 제거)");
assertEq(cleanSheetTitle("가".repeat(24)), "가".repeat(24), "정확히 24자는 그대로");

console.log(`sheet-title: ${passed}개 통과`);
