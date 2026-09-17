# 仿生机械手控制方案（测试稿）

这是一篇用于验证 md2pdf 排版效果的样例文档，涵盖标题、表格、代码、引用、列表、链接与数学公式等常见元素。第一段会自动被识别为导语并放大显示。

## 一、总体指标

| 指标 | 目标值 | 实测值 |
| --- | --- | --- |
| 抓取成功率 | ≥ 98% | 98.6% |
| 单指响应延迟 | ≤ 12 ms | 10.4 ms |
| 整机功耗 | ≤ 15 W | 13.8 W |

指标以课题组内部测试平台为准，环境温度 25 ± 2 ℃。

## 二、控制流程

1. 采集六维力与关节角
   - 采样率 1 kHz
   - 滑动窗口去噪
2. 估计接触状态
3. 生成阻抗控制指令

> 注意：阻抗参数在更换指尖材料后必须重新标定，否则会出现持续振荡。

阻抗控制的目标动力学可写为：

$$ \tau = K_p\,(\theta_d - \theta) + K_d\,(\dot{\theta}_d - \dot{\theta}) $$

其中 $K_p$ 为刚度系数，$K_d$ 为阻尼系数，$\tau$ 为关节力矩。该控制律的稳定性分析见文献[^smith2023]，参数整定可参考专著[^astrom]。

核心逻辑如下：

```python
def impedance_control(f_err, kp=1.2, kd=0.05):
    """简单的阻抗控制器"""
    dx = kp * f_err - kd * velocity
    return clamp(dx, -X_MAX, X_MAX)
```

## 三、参考文献

- 国家知识产权局《专利审查指南（2023）》，见 [官方链接](https://www.cnipa.gov.cn/art/2023/12/21/art_99_189202.html)
- 课题组内部技术报告，编号 TR-2026-07

[^smith2023]: @article{smith2023,
  author = {Smith, John and Johnson, Mary},
  title = {Stability Analysis of Impedance Control for Robotic Hands},
  journal = {IEEE Transactions on Robotics},
  year = {2023},
  volume = {39},
  number = {4},
  pages = {2900--2915},
  doi = {10.1109/TRO.2023.1234567}
  }

[^astrom]: @book{astrom2008,
  author = {Åström, Karl Johan and Murray, Richard M.},
  title = {Feedback Systems: An Introduction for Scientists and Engineers},
  publisher = {Princeton University Press},
  address = {Princeton},
  year = {2008}
  }

---

文档结束。
