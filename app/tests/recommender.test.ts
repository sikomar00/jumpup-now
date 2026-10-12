import { describe, expect, it } from 'vitest'
import { daysUntil, recommend, rescueStep, type RecoTask } from '../src/domain/recommender'

const NOW = new Date(2026, 9, 12, 14, 30).getTime() // 로컬 10/12 14:30
const day = (offset: number) => new Date(2026, 9, 12 + offset, 23, 0).getTime()

describe('recommend', () => {
  it('후보가 없으면 null', () => {
    expect(recommend([], NOW)).toBeNull()
  })

  it('마감이 가까운 항목이 먼저다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '다음 주', due: day(7), size: 'small' },
      { id: 'b', title: '내일', due: day(1), size: 'medium' }
    ]
    expect(recommend(tasks, NOW)?.task.id).toBe('b')
  })

  it('마감이 지난 항목이 가장 우선이다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '오늘', due: day(0), size: 'small' },
      { id: 'b', title: '지남', due: day(-2), size: 'large' }
    ]
    const r = recommend(tasks, NOW)
    expect(r?.task.id).toBe('b')
    expect(r?.reason).toContain('마감 지남')
  })

  it('마감이 같으면 크기가 작은 항목이 먼저다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '큼', due: day(3), size: 'large' },
      { id: 'b', title: '작음', due: day(3), size: 'small' }
    ]
    expect(recommend(tasks, NOW)?.task.id).toBe('b')
  })

  it('마감이 없는 항목은 마감 있는 항목보다 뒤다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '마감없음', size: 'small' },
      { id: 'b', title: '먼 마감', due: day(20), size: 'large' }
    ]
    expect(recommend(tasks, NOW)?.task.id).toBe('b')
  })

  it('입력이 전혀 없으면 목록 순서를 따른다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '첫째' },
      { id: 'b', title: '둘째' }
    ]
    const r = recommend(tasks, NOW)
    expect(r?.task.id).toBe('a')
    expect(r?.reason).toBe('목록 순서')
  })

  it('최근 거절한 항목은 뒤로 밀린다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '거절됨', due: day(1), size: 'small' },
      { id: 'b', title: '다음 후보', due: day(3), size: 'small' }
    ]
    expect(recommend(tasks, NOW, { recentRejectedIds: ['a'] })?.task.id).toBe('b')
  })

  it('후보가 하나뿐이면 거절되어도 그 항목을 돌려준다', () => {
    const tasks: RecoTask[] = [{ id: 'a', title: '유일', size: 'small' }]
    expect(recommend(tasks, NOW, { recentRejectedIds: ['a'] })?.task.id).toBe('a')
  })

  it('거절 이력은 최근 3개만 반영한다', () => {
    const tasks: RecoTask[] = [
      { id: 'a', title: '오래전 거절', due: day(1), size: 'small' },
      { id: 'b', title: '다른 항목', due: day(5), size: 'small' }
    ]
    const history = { recentRejectedIds: ['a', 'x', 'y', 'z'] }
    expect(recommend(tasks, NOW, history)?.task.id).toBe('a')
  })

  it('크기에 따라 첫 행동 문구가 달라진다', () => {
    const base = { id: 'a', title: 't' }
    expect(recommend([{ ...base, size: 'small' }], NOW)?.firstStep).toContain('5분')
    expect(recommend([{ ...base, size: 'large' }], NOW)?.firstStep).toContain('가장 작은')
    expect(recommend([base], NOW)?.firstStep).toContain('10분')
  })
})

describe('daysUntil / rescueStep', () => {
  it('날짜 경계 기준으로 일수를 센다', () => {
    expect(daysUntil(day(0), NOW)).toBe(0)
    expect(daysUntil(day(1), NOW)).toBe(1)
    expect(daysUntil(day(-1), NOW)).toBe(-1)
  })

  it('막힘 단계가 오를수록 행동이 작아진다', () => {
    expect(rescueStep(1)).toContain('2분')
    expect(rescueStep(2)).toContain('1분')
  })
})
