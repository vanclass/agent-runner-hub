// 초기 준비 제한 시간이다. 늘리면 느린 호스트를 더 기다리고, 줄이면 실패를 빨리 알린다.
export const startupMs = 60_000;
// 등록 역할의 실제 완료를 기다리는 테스트 제한이다. 늘리면 느린 모델 실행을 더 기다리고, 줄이면 검증을 더 빨리 중단한다.
export const subagentCompletionMs = 10 * 60_000;
// 명령과 종료 제한 시간이다. 늘리면 지연을 허용하고, 줄이면 정지를 빨리 감지한다.
export const commandMs = 10_000;
export const pollMs = 200;