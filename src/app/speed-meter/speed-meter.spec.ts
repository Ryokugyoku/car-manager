import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpeedMeter } from './speed-meter';

describe('SpeedMeter', () => {
  let component: SpeedMeter;
  let fixture: ComponentFixture<SpeedMeter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpeedMeter],
    }).compileComponents();

    fixture = TestBed.createComponent(SpeedMeter);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
