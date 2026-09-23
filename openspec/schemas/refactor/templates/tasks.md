## 1. Pin behaviour: <!-- behaviour being protected -->

Seam:
<!-- Highest seam through which this behaviour is verified -->

Tasks:
- [ ] 1.1 Create an isolated git workspace for the refactor
- [ ] 1.2 RED: Add the failing behavioural test that pins this existing behaviour through the seam
- [ ] 1.3 GREEN: Bring the pinning test to pass against the current code (behaviour unchanged)
- [ ] 1.4 Commit to git

## 2. Refactor: <!-- structural change -->

Target shape:
<!-- The concrete shape being moved to -->

Tasks:
- [ ] 2.1 REFACTOR: Perform the structural change while every test stays green
- [ ] 2.2 Verify all tests still pass (unit & integration)
- [ ] 2.3 Commit to git & declare completion
