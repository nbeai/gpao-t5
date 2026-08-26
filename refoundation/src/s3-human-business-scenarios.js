import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const CONFIG_URL = new URL('../config/s3-human-business-scenarios.json', import.meta.url);

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
}

export async function loadS3HumanBusinessScenarios() {
  const value = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
  if (value?.schema !== 't5.s3.human-business-scenarios.v1') {
    throw new Error('invalid S3 human business scenario schema');
  }
  const sourceIds = new Set((value.sourceRecords ?? []).map((item) => item.id));
  const structuralStressIds = new Set(value.portfolioPolicy?.structuralStressScenarioIds ?? []);
  return {
    ...value,
    scenarios: value.scenarios.map((item) => {
      const sourceGrounded = item.qualificationStatus === 'source_grounded';
      if (sourceGrounded && !(item.sourceRefs ?? []).every((id) => sourceIds.has(id))) {
        throw new Error(`scenario ${item.id} has an unresolved sourceRef`);
      }
      if (sourceGrounded) return { ...item, portfolioRole: 'observed_demand' };
      return {
        ...item,
        qualificationStatus: 'research_derived_hypothesis',
        expressionKind: item.expressionKind ?? 'synthetic_from_researched_workflow',
        sourceRefs: item.sourceRefs ?? [],
        requestStage: item.requestStage ?? 'operate_after_evidence_ready',
        portfolioRole: structuralStressIds.has(item.id)
          ? 'structural_stress' : 'workflow_coverage',
      };
    }),
  };
}

export async function findS3HumanBusinessScenario(id) {
  const catalog = await loadS3HumanBusinessScenarios();
  const scenario = catalog.scenarios.find((item) => item.id === String(id ?? ''));
  if (!scenario) throw new Error(`unknown S3 human business scenario: ${id}`);
  return { catalog, scenario };
}

export function auditS3HumanBusinessPortfolio(catalog) {
  if (!catalog || !Array.isArray(catalog.scenarios)) throw new TypeError('catalog scenarios are required');
  const ids = catalog.scenarios.map((item) => item.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) throw new Error('duplicate S3 human business scenario id');
  const sourceIds = new Set((catalog.sourceRecords ?? []).map((item) => item.id));
  const environmentIds = new Set((catalog.environmentProfiles ?? []).map((item) => item.id));
  for (const scenario of catalog.scenarios) {
    if (!environmentIds.has(scenario.environment)) {
      throw new Error(`scenario ${scenario.id} has an unknown environment`);
    }
    if (scenario.qualificationStatus === 'source_grounded'
      && !(scenario.sourceRefs ?? []).every((id) => sourceIds.has(id))) {
      throw new Error(`scenario ${scenario.id} has an unresolved sourceRef`);
    }
  }
  for (const wave of catalog.qualificationWaves ?? []) {
    if (new Set(wave.scenarioIds).size !== wave.scenarioIds.length) {
      throw new Error(`qualification wave ${wave.id} repeats a scenario`);
    }
    for (const id of wave.scenarioIds) {
      if (!uniqueIds.has(id)) throw new Error(`qualification wave ${wave.id} has unknown scenario ${id}`);
    }
    const roles = new Set(wave.scenarioIds.map((id) => (
      catalog.scenarios.find((item) => item.id === id)?.portfolioRole
    )));
    for (const required of ['observed_demand', 'workflow_coverage', 'structural_stress']) {
      if (!roles.has(required)) throw new Error(`qualification wave ${wave.id} misses ${required}`);
    }
  }
  const byRole = Object.fromEntries(['observed_demand', 'workflow_coverage', 'structural_stress']
    .map((role) => [role, catalog.scenarios.filter((item) => item.portfolioRole === role).length]));
  return {
    scenarioCount: ids.length,
    byRole,
    sourceCount: sourceIds.size,
    environmentCount: environmentIds.size,
    waveCount: (catalog.qualificationWaves ?? []).length,
    researchBacklog: [...(catalog.coverageStatus?.researchBacklog ?? [])],
  };
}

export function planS3HumanBusinessWave(catalog, waveId) {
  auditS3HumanBusinessPortfolio(catalog);
  const wave = (catalog.qualificationWaves ?? []).find((item) => item.id === waveId);
  if (!wave) throw new Error(`unknown S3 human business qualification wave: ${waveId}`);
  return {
    schema: 't5.s3.human-business-wave.v1',
    id: wave.id,
    purpose: wave.purpose,
    modelPolicy: wave.modelPolicy,
    close: wave.close,
    scenarios: wave.scenarioIds.map((id) => {
      const scenario = catalog.scenarios.find((item) => item.id === id);
      return {
        id: scenario.id,
        title: scenario.title,
        business: scenario.business,
        domain: scenario.domain,
        environment: scenario.environment,
        qualificationStatus: scenario.qualificationStatus,
        portfolioRole: scenario.portfolioRole,
        variants: 1 + (scenario.alternatePrompts?.length ?? 0),
      };
    }),
  };
}

async function ecommerceExports(workspace, { partial = false } = {}) {
  const root = join(workspace, '판매자료', '2026-07');
  await write(join(root, '스마트스토어_주문.csv'), [
    '주문번호,주문일,판매처상품코드,상품명,수량,상품결제금액,상태',
    'NS-1001,2026-07-03,P-BLUE,블루 파우치,3,36000,구매확정',
    'NS-1002,2026-07-05,P-BLUE,블루 파우치,1,12000,반품완료',
    'NS-1003,2026-07-07,P-RED,레드 파우치,2,18000,구매확정',
    'NS-1004,2026-07-12,P-GREEN,그린 파우치,2,30000,취소완료',
    'NS-1005,2026-07-19,P-BLUE,블루 파우치,2,24000,구매확정',
  ].join('\n'));
  if (!partial) {
    await write(join(root, '쿠팡_주문.csv'), [
      '주문번호,주문일,판매자상품코드,노출상품명,수량,매출금액,상태',
      'CP-2001,2026-07-04,P-BLUE,파우치 블루,5,59000,배송완료',
      'CP-2002,2026-07-09,P-GREEN,파우치 그린,2,30000,취소',
      'CP-2003,2026-07-16,P-RED,파우치 레드,1,9500,배송완료',
      'CP-2004,2026-07-22,P-BLUE,파우치 블루,1,11800,반품완료',
    ].join('\n'));
    await write(join(root, '현재재고.csv'), [
      '상품코드,상품명,현재고,입고예정,입고예정일',
      'P-BLUE,블루 파우치,4,0,',
      'P-RED,레드 파우치,20,10,2026-08-03',
      'P-GREEN,그린 파우치,3,0,',
    ].join('\n'));
    await write(join(root, '상품원가.csv'), [
      '상품코드,상품명,현재판매가,단위원가,포장비',
      'P-BLUE,블루 파우치,12000,5200,500',
      'P-RED,레드 파우치,9000,4800,500',
      'P-GREEN,그린 파우치,15000,8300,700',
    ].join('\n'));
    await write(join(root, '광고성과.csv'), [
      '캠페인,상품코드,광고비,광고클릭,광고귀속주문,광고귀속매출',
      '신학기-블루,P-BLUE,45000,310,6,70800',
      '기본-레드,P-RED,28000,170,3,27000',
      '신제품-그린,P-GREEN,39000,220,1,15000',
    ].join('\n'));
    await write(join(root, '고객문의_반품메모.csv'), [
      '문의번호,주문번호,상품코드,유형,내용',
      'Q-01,NS-1002,P-BLUE,반품,화면에서 본 것보다 색이 어둡고 크기 설명을 찾기 어려웠어요',
      'Q-02,CP-2004,P-BLUE,반품,지퍼 부분 사진이 실제와 다르게 보여요',
      'Q-03,NS-1005,P-BLUE,문의,포장 설명은 이해하기 쉬웠어요',
      'Q-04,CP-2003,P-RED,배송,배송은 언제 시작하나요',
    ].join('\n'));
  }
  return {
    expectedFacts: partial ? {
      evidenceCoverage: 'smartstore_only', smartstorePaidRevenue: 78000,
    } : {
      bluePaidQuantity: 10, bluePaidRevenue: 119000,
      redPaidQuantity: 3, redPaidRevenue: 27500, blueCurrentStock: 4,
    },
  };
}

async function restaurantExports(workspace) {
  const root = join(workspace, '매장운영', '2026-07');
  await write(join(root, 'POS_매장주문.csv'), [
    '주문일,주문번호,메뉴코드,메뉴명,수량,결제금액',
    '2026-07-02,POS-01,M-PASTA,비빔파스타,4,52000',
    '2026-07-03,POS-02,M-BOWL,제육덮밥,7,70000',
    '2026-07-05,POS-03,M-COFFEE,아메리카노,12,48000',
    '2026-07-06,POS-04,M-PASTA,비빔파스타,3,39000',
  ].join('\n'));
  await write(join(root, '배달주문.csv'), [
    '주문일,주문번호,메뉴코드,메뉴명,수량,고객결제금액,플랫폼수수료,할인지원',
    '2026-07-02,D-01,M-PASTA,비빔파스타,8,104000,15600,0',
    '2026-07-04,D-02,M-BOWL,제육덮밥,13,130000,19500,10000',
    '2026-07-05,D-03,M-COFFEE,아메리카노,5,20000,3000,0',
  ].join('\n'));
  await write(join(root, '메뉴원가.csv'), [
    '메뉴코드,메뉴명,판매가,재료원가,포장비',
    'M-PASTA,비빔파스타,13000,6200,800',
    'M-BOWL,제육덮밥,10000,4300,700',
    'M-COFFEE,아메리카노,4000,900,300',
  ].join('\n'));
  await write(join(root, '현재재료.csv'), [
    '재료,현재고,단위,최근주간폐기,입고리드타임일',
    '파스타면,32,인분,2,2',
    '제육,18,인분,1,1',
    '원두,45,잔,3,2',
    '샐러드채소,12,인분,5,1',
  ].join('\n'));
  await write(join(root, '리뷰.csv'), [
    '리뷰번호,일자,평점,메뉴코드,내용',
    'RV-01,2026-07-03,3,M-PASTA,맛은 좋은데 배달 포장이 조금 샜어요',
    'RV-02,2026-07-04,2,M-PASTA,소스가 포장 밖으로 흘렀어요',
    'RV-03,2026-07-05,5,M-BOWL,양도 좋고 따뜻했어요',
    'RV-04,2026-07-06,4,M-PASTA,맛있는데 포장만 개선되면 좋겠어요',
    'RV-05,2026-07-07,5,M-COFFEE,빠르게 왔어요',
  ].join('\n'));
  await write(join(root, '운영메모.md'), '# 운영 메모\n- 매장 공통 고정비와 인건비는 이 자료에 포함하지 않음\n- 2026-08-03 월요일 임시휴무 예정\n- 2026-08-04 화요일 13시 영업 시작 예정\n');
  return { expectedFacts: { fullNetProfitAvailable: false, repeatedReviewTheme: '파스타 배달 포장' } };
}

async function reservationService(workspace) {
  const root = join(workspace, '예약고객', '2026-06_07');
  await write(join(root, '예약내역.csv'), [
    '예약번호,고객코드,예약일,요일,시간,서비스코드,상태,변경사유',
    'B-001,C-101,2026-06-03,수,11:00,S-01,완료,',
    'B-002,C-102,2026-06-07,일,15:00,S-02,노쇼,연락없음',
    'B-003,C-103,2026-06-14,일,15:00,S-02,당일취소,개인사정',
    'B-004,C-102,2026-06-21,일,15:00,S-02,노쇼,연락없음',
    'B-005,C-104,2026-07-05,일,15:00,S-01,당일취소,일정변경',
    'B-006,C-105,2026-07-12,일,15:00,S-02,완료,',
    'B-007,C-106,2026-07-19,일,17:00,S-01,완료,',
    'B-008,C-101,2026-07-22,수,11:00,S-01,완료,',
  ].join('\n'));
  await write(join(root, '서비스가격.csv'), [
    '서비스코드,서비스명,현재가격,소요분,변경예정가격',
    'S-01,기본관리,50000,60,55000',
    'S-02,집중관리,80000,90,85000',
  ].join('\n'));
  await write(join(root, '방문이력.csv'), [
    '고객코드,최근방문일,최근6개월방문수,미해결불만',
    'C-101,2026-07-22,5,false',
    'C-102,2026-03-02,4,true',
    'C-103,2026-04-10,3,false',
    'C-104,2026-07-05,1,false',
    'C-105,2026-07-12,2,false',
  ].join('\n'));
  await write(join(root, '문의내보내기.csv'), [
    '문의번호,고객코드,일시,내용,예약번호',
    'I-01,C-103,2026-07-25T09:10,가격이 다음 달부터 바뀌나요,',
    'I-02,C-104,2026-07-25T09:20,예약 시간을 오후 3시로 바꾸고 싶어요,B-004',
    'I-03,C-102,2026-07-25T09:35,지난번 상담 답변을 아직 못 받았어요,',
    'I-04,C-105,2026-07-25T10:00,주차 가능한가요,',
  ].join('\n'));
  await write(join(root, '직원가능시간.csv'), '직원코드,요일,가능시간\nST-01,월-금,10:00-18:00\nST-02,토-일,13:00-18:00\n');
  return { expectedFacts: { highestNoShowSlot: '일요일 15:00' } };
}

async function freelancerProject(workspace) {
  const root = join(workspace, '고객프로젝트', '라온브랜드');
  await write(join(root, '계약서_현재.md'), '# 업무 계약\n- 범위: 시장조사, 브랜드 메시지 초안, 최종 보고서 PDF 1부\n- 기간: 2026-07-01~2026-08-15\n- 금액: 3,000,000원\n- 추가 작업: 별도 서면 합의\n- 시간제 추가업무 단가: 시간당 100,000원\n');
  await write(join(root, '이번미팅.md'), '# 2026-07-24 미팅\n- 기존 범위 유지: 시장조사와 브랜드 메시지\n- 요청: 경쟁사 SNS 사례도 함께 검토\n- 요청: 발표용 슬라이드는 가능 여부와 추가 비용 확인 후 결정\n- 보고서 초안은 파일로 만들기 전에 목차를 먼저 검토\n');
  await write(join(root, '과거프로젝트_요약.md'), '# 2025 라온 리뉴얼\n- 당시 범위: 고객 인터뷰 10건, 메시지 워크숍, 발표 슬라이드\n- 당시 일정과 금액은 현재 계약에 적용되지 않음\n- 재사용 가능: 경쟁사 분류 기준과 보고서 목차 구조\n');
  await write(join(root, '작업시간.csv'), '날짜,프로젝트,업무,시간\n2026-07-03,라온브랜드,시장조사,3.5\n2026-07-08,라온브랜드,자료정리,2\n2026-07-24,라온브랜드,고객미팅,1.5\n2026-07-25,내부,템플릿정리,2\n');
  await write(join(root, '고객요구사항.md'), '# 현재 요구사항\n- 시장 자료의 출처 링크\n- 경쟁사 5곳 비교\n- 브랜드 메시지 3안\n- 확인되지 않은 수치는 추정 표시\n');
  await write(join(root, '납품후보.md'), '# 보고서 후보\n- 시장 자료 링크: 일부 누락\n- 경쟁사 비교: 5곳 완료\n- 브랜드 메시지: 3안 완료\n- 추정 수치 표시: 완료\n');
  return { expectedFacts: { slidesApproved: false, billableHours: 7 } };
}

async function manufacturingOps(workspace) {
  const root = join(workspace, '생산운영', '2026-08');
  await write(join(root, '수주.csv'), [
    '수주번호,거래처코드,제품코드,수량,납기일,상태',
    'O-001,B-01,P-A,80,2026-08-05,확정',
    'O-002,B-02,P-B,40,2026-08-06,확정',
    'O-003,B-03,P-A,70,2026-08-07,확정',
    'O-004,B-04,P-C,50,2026-08-10,문의',
  ].join('\n'));
  await write(join(root, '완제품재고.csv'), '제품코드,현재고\nP-A,30\nP-B,25\nP-C,10\n');
  await write(join(root, '주간생산능력.csv'), '제품코드,이번주생산가능,다음주생산가능\nP-A,90,120\nP-B,10,50\nP-C,20,40\n');
  await write(join(root, 'BOM.csv'), '제품코드,원자재코드,제품1개당소요량\nP-A,R-1,2\nP-A,R-2,1\nP-B,R-1,1\nP-B,R-3,3\nP-C,R-2,2\n');
  await write(join(root, '원자재재고.csv'), '원자재코드,현재고,입고예정,입고예정일\nR-1,200,100,2026-08-04\nR-2,100,0,\nR-3,70,100,2026-08-08\n');
  await write(join(root, '매출채권.csv'), '청구번호,거래처코드,청구금액,약정입금일,입금액,상태\nIV-01,B-01,5200000,2026-07-20,5200000,완료\nIV-02,B-02,3100000,2026-07-25,0,미입금\nIV-03,B-03,4700000,2026-07-30,2000000,부분입금\n');
  await write(join(root, '공급사견적.csv'), '견적번호,공급사,원자재코드,단가,최소수량,납기일,결제조건\nQ-01,S-01,R-1,1100,100,2026-08-04,선결제\nQ-02,S-02,R-1,1180,50,2026-08-02,월말결제\nQ-03,S-03,R-1,1050,200,2026-08-08,조건미기재\n');
  await write(join(root, '품질문의.csv'), '문의번호,수주번호,제품코드,내용,확인상태\nQC-01,O-001,P-A,표면 긁힘 3개,공정미확인\nQC-02,O-003,P-A,표면 긁힘 2개,포장공정 확인중\nQC-03,O-002,P-B,규격 문의,불량아님\n');
  return { expectedFacts: { pAConfirmedDemand: 150, pAAvailableThisWeek: 120 } };
}

async function officeAdmin(workspace) {
  const root = join(workspace, '경영관리', '2026-07');
  await write(join(root, '매출.csv'), '거래번호,일자,거래처,공급가액,부가세,결제상태\nS-01,2026-07-03,C-01,1000000,100000,입금완료\nS-02,2026-07-10,C-02,2000000,200000,미입금\nS-03,2026-07-22,C-03,500000,50000,입금완료\n');
  await write(join(root, '매입.csv'), '거래번호,일자,공급사,공급가액,부가세,증빙번호\nP-01,2026-07-04,V-01,300000,30000,TI-01\nP-02,2026-07-11,V-02,450000,45000,\nP-03,2026-07-18,V-03,120000,12000,CR-03\n');
  await write(join(root, '전자세금계산서.csv'), '증빙번호,일자,공급자,공급가액,부가세\nTI-01,2026-07-04,V-01,300000,30000\nTI-04,2026-07-26,V-04,200000,20000\n');
  await write(join(root, '카드영수증.csv'), '증빙번호,일자,가맹점,금액,메모\nCR-03,2026-07-18,V-03,132000,업무용 소모품\nCR-05,2026-07-20,생활마트,87000,용도 확인 필요\n');
  await write(join(root, '현금일정.csv'), '일자,구분,항목,금액,확실성\n2026-08-01,기초잔고,통장잔고,2500000,확정\n2026-08-05,유입,C-02 미수금,2200000,예정\n2026-08-08,유출,사무실임대료,1100000,확정\n2026-08-12,유출,외주비,1800000,확정\n2026-08-20,유입,신규계약 선금,1500000,미확정\n');
  await write(join(root, '계약서_이전.md'), '# 서비스 계약\n- 금액: 600만원\n- 기간: 6개월\n- 해지: 30일 전 통보\n- 손해배상: 직접손해 한도 계약금액\n');
  await write(join(root, '계약서_신규.md'), '# 서비스 계약\n- 금액: 650만원\n- 기간: 12개월 자동연장\n- 해지: 60일 전 통보\n- 손해배상: 손해 범위와 한도 별도 기재 없음\n');
  await write(join(root, '회의메모.md'), '# 7월 28일 운영회의\n- 확정: 신규 홈페이지 공개일 8월 20일\n- 담당: 콘텐츠 초안 민지, 기술 점검 현우\n- 콘텐츠 초안 마감: 8월 8일\n- 기술 점검 마감: 미정\n- 논의 필요: 광고 예산, 촬영 일정\n');
  return { expectedFacts: { missingPurchaseEvidence: 'P-02', uncertainCashInflow: 1500000 } };
}

async function marketingCrm(workspace) {
  const root = join(workspace, '마케팅고객', '2026-07');
  await write(join(root, '광고성과.csv'), '캠페인,채널,비용,노출,클릭,문의,구매,귀속매출\nA-검색,네이버,300000,40000,1200,80,18,1440000\nB-신제품,인스타그램,420000,90000,2100,130,9,810000\nC-재방문,카카오,180000,15000,700,60,20,1600000\n');
  await write(join(root, '콘텐츠일정.csv'), '게시예정일,채널,주제,상태\n2026-08-03,인스타그램,신제품 사용법,초안\n2026-08-05,네이버블로그,고객 사례,자료부족\n2026-08-07,카카오채널,재구매 혜택,검토중\n');
  await write(join(root, '리뷰.csv'), '리뷰번호,고객코드,평점,내용\nR-01,C-01,5,설명이 쉬워서 바로 쓸 수 있었어요\nR-02,C-02,3,배송 안내를 찾기 어려웠어요\nR-03,C-03,2,배송이 늦었는데 답변도 늦었어요\nR-04,C-04,4,제품은 좋지만 배송 안내가 더 자세하면 좋겠어요\n');
  await write(join(root, '문의.csv'), '문의번호,고객코드,일시,유형,내용,관련번호\nI-01,C-05,2026-07-30T09:10,가격,대량 구매 가격이 궁금합니다,\nI-02,C-02,2026-07-30T09:12,배송,주문 배송이 어디까지 왔나요,O-88\nI-03,C-03,2026-07-30T09:20,불만,지난 문의 답변을 아직 못 받았습니다,I-00\nI-04,C-06,2026-07-30T10:30,예약변경,금요일 예약을 토요일로 바꾸고 싶어요,B-77\n');
  await write(join(root, '기존FAQ.md'), '# 자주 묻는 질문\n## 가격\n제품별 가격표를 확인해 주세요.\n## 배송\n결제 후 순서대로 발송합니다.\n');
  return { expectedFacts: { highestAttributedRoasCampaign: 'C-재방문', repeatedReviewTheme: '배송 안내' } };
}

async function continuityControl(workspace) {
  const fixture = await ecommerceExports(workspace);
  const script = join(workspace, '월간보고_준비.mjs');
  await write(script, [
    "import {appendFile} from 'node:fs/promises';",
    "const out=new URL('./진행기록.log',import.meta.url);",
    "for(let i=1;i<=15;i++){await appendFile(out,`step=${i}\\n`);process.stdout.write(`STEP ${i}/15\\n`);await new Promise(r=>setTimeout(r,2000));}",
    "process.stdout.write('COMPLETE\\n');",
  ].join('\n'));
  return { ...fixture, expectedFacts: { ...fixture.expectedFacts, processSteps: 15 } };
}

const MATERIALIZERS = Object.freeze({
  ecommerce_exports_present: (workspace) => ecommerceExports(workspace),
  ecommerce_no_data: async (workspace) => {
    await mkdir(join(workspace, '판매자료'), { recursive: true, mode: 0o700 });
    return { expectedFacts: { availableSalesEvidence: false } };
  },
  ecommerce_partial_export: (workspace) => ecommerceExports(workspace, { partial: true }),
  restaurant_exports: restaurantExports,
  reservation_service: reservationService,
  freelancer_project: freelancerProject,
  manufacturing_ops: manufacturingOps,
  office_admin: officeAdmin,
  marketing_crm: marketingCrm,
  continuity_control: continuityControl,
});

export async function materializeS3HumanBusinessScenario({ scenario, catalog, workspace }) {
  if (!scenario || !catalog || !workspace) throw new TypeError('scenario, catalog and workspace are required');
  const profile = catalog.environmentProfiles.find((item) => item.id === scenario.environment);
  if (!profile) throw new Error(`missing environment profile: ${scenario.environment}`);
  const materialize = MATERIALIZERS[profile.fixtureKind];
  if (!materialize) throw new Error(`unsupported fixture kind: ${profile.fixtureKind}`);
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const result = await materialize(workspace);
  return { profile: structuredClone(profile), expectedFacts: result.expectedFacts ?? {} };
}

async function walk(root, current = root) {
  const output = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) output.push(...await walk(root, path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

export async function snapshotS3BusinessWorkspace(root) {
  const output = {};
  for (const path of (await walk(root)).sort()) {
    const info = await stat(path);
    output[relative(root, path)] = {
      bytes: info.size,
      sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    };
  }
  return output;
}

export function diffS3BusinessWorkspace(before = {}, after = {}) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const created = []; const modified = []; const deleted = [];
  for (const path of [...paths].sort()) {
    if (!before[path]) created.push(path);
    else if (!after[path]) deleted.push(path);
    else if (before[path].sha256 !== after[path].sha256 || before[path].bytes !== after[path].bytes) {
      modified.push(path);
    }
  }
  return { created, modified, deleted };
}
