PVObject_=pvModule
  Version=7.4
  Flags=$00908043

  PVObject_Commercial=pvCommercial
    Comment=Shanghai JA Solar Technology Co., Ltd.
    Flags=$0041
    Manufacturer=JA Solar
    Model=JAM72D40-595/LB
    DataSource=TÜV SÜD
    YearBeg=2023
    Width=1.134
    Height=2.333
    Depth=0.030
    Weight=32.500
    NPieces=100
    PriceDate=26/04/20 17:20
    Remarks, Count=5
      Str_1=Frame: Aluminum
      Str_2=Structure: 2.0mm double glass module
      Str_3
      Str_4
      Str_5
    End of Remarks
  End of PVObject pvCommercial

  Technol=mtSiMono
  NCelS=72
  NCelP=2
  NDiode=3
  SubModuleLayout=slTwinHalfCells
  FrontSurface=fsARCoating
  GRef=1000
  TRef=25.0
  PNom=595.0
  PNomTolLow=0.00
  PNomTolUp=3.00
  BifacialityFactor=0.781
  Isc=14.420
  Voc=52.20
  Imp=13.650
  Vmp=43.59
  muISC=6.63
  muVocSpec=-127.0
  muPmpReq=-0.290
  RShunt=300
  Rp_0=5500
  Rp_Exp=5.50
  RSerie=0.196
  Gamma=1.026
  muGamma=-0.0003
  VMaxIEC=1500
  VMaxUL=1500
  Absorb=0.90
  ARev=3.200
  BRev=11.496
  RDiode=0.010
  VRevDiode=-0.70
  AirMassRef=1.500
  CellWidth=0.182
  CellHeight=0.094
  SandiaAMCorr=50.000
  RelEffic800=0.29
  RelEffic600=0.26
  RelEffic400=0.14
  RelEffic200=-1.57

  PVObject_IAM=pvIAM
    Flags=$00
    IAMMode=UserProfile
    IAMProfile=TCubicProfile
      NPtsMax=9
      NPtsEff=8
      LastCompile=$B18D
      Mode=3
      Point_1=0.0,1.00000
      Point_2=60.0,1.00000
      Point_3=65.0,0.98800
      Point_4=70.0,0.96900
      Point_5=75.0,0.94500
      Point_6=80.0,0.87700
      Point_7=85.0,0.75400
      Point_8=90.0,0.00000
      Point_9=0.0,0.00000
    End of TCubicProfile
  End of PVObject pvIAM

  OperPoints, list of=12 tOperPoint
    Point_1=False,100,15.0,-3.65,0.00,0.000,0.000,0.00,58.46
    Point_2=False,200,15.0,1.37,0.00,0.000,0.000,0.00,123.00
    Point_3=False,400,15.0,3.20,0.00,0.000,0.000,0.00,250.45
    Point_4=False,600,15.0,3.22,0.00,0.000,0.000,0.00,375.75
    Point_5=False,800,15.0,3.29,0.00,0.000,0.000,0.00,501.34
    Point_6=False,100,25.0,-6.30,0.00,0.000,0.000,0.00,55.28
    Point_7=False,200,25.0,-1.57,0.00,0.000,0.000,0.00,116.15
    Point_8=False,400,25.0,0.14,0.00,0.000,0.000,0.00,236.33
    Point_9=False,600,25.0,0.26,0.00,0.000,0.000,0.00,354.91
    Point_10=False,800,25.0,0.29,0.00,0.000,0.000,0.00,473.36
    Point_11=True,1000,25.0,0.00,52.00,14.350,13.590,43.41,589.94
    Point_12=False,1100,25.0,-0.21,0.00,0.000,0.000,0.00,647.63
  End of List OperPoints
End of PVObject pvModule
